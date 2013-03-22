
(function () {

    if (!String.prototype.toJSON) {
        String.prototype.toJSON = function () {
            return '"' + this + '"';
        };
    }

    var initted = false;
    document.addEventListener('load', function instrumentBackbone(ev) {
        if (window.Backbone && !initted) {
            document.removeEventListener('load', instrumentBackbone);
            init();
            console.log('BBVis: Backbone instrumented.');
            initted = true;
            window.postMessage({ bbvis: { loaded: true } }, location.href);
        }
    }, true);

    function highlight($els, opts) {
        if ($els && $els.offset && $els.outerHeight && $els.outerWidth && $els.map) {
            return $els.map(function () {
                var $el = $(this);
                var offset = $el.offset();
                var height = $el.outerHeight() || parseFloat($el.attr('height'));
                var width = $el.outerWidth() || parseFloat($el.attr('width'));
                var $box = $('<div>').css({
                    position: 'absolute',
                    left: offset.left,
                    top: offset.top,
                    width: width,
                    height: height,
                    border: '2px solid rgba(0, 255, 0, 0.8)',
                    background: 'rgba(0, 255, 0, 0.3)',
                    opacity: opts.opacity || 1,
                    zIndex: 59999,
                    pointerEvents: 'none',
                    boxSizing: 'border-box'
                }).appendTo('body');
                if (opts.fade) {
                    $box.animate({
                        opacity: 0
                    }, opts.fade, function() { $(this).remove(); });
                }
                return $box[0];
            });
        } else {
            return [];
        }
    }

    function getObj(obj) {
        if (obj) {
            // optionally dereference context for compatibility with TBone Scope objects,
            // and only return the resulting object if it's a Backbone Model/View/Collection
            var o = obj.context || obj;
            return o.bbvistype && o;
        } else {
            return null;
        }
    }

    function getListeners(self) {
        var listeners = [];
        function add(context) {
            var listener = getObj(context);
            /**
             * Don't publish event binding of collections to their
             * own models; this happens automatically in backbone.
             **/
            if (listener && listener !== self.collection) {
                listeners.push(listener);
            }
        }
        // Older backbone:
        _.each(_.values(self._callbacks || {}), function (ll) {
            var curr = ll.next;
            while (curr) {
                if (curr.context) {
                    add(curr.context);
                }
                curr = curr.next;
            }
        });
        // Newer backbone:
        _.each(_.flatten(_.values(self._events || {})), function (ev) {
            if (ev.context) {
                add(ev.context);
            }
        });
        return _.uniq(listeners);
    }

    var lastmsg = {};
    var objs = {};
    var objParallels = {};
    var dirty = {};
    var cleanTimer;
    var nextId = 1;
    var paused = true;

    function ObjParallel (obj) {
        var self = this;
        this.id = getId(obj);
        this.obj = getObj(obj);
        this.data = "(no data)";

        this.ping = _.debounce(function () {
            if (this.sendEnabled) {
                // console.log('ping ' + this.id);
                window.postMessage({ bbvis: { id: this.id, ping: true } }, location.href);
            }
            // if (self.obj.bbvistype === 'view' && !paused) {
            //     highlight(self.obj.$el, { opacity: 0.2, fade: 1000 });
            // }
        }, 200);
    }

    var $lastHoverHighlight;

    function hover (id) {
        if ($lastHoverHighlight) {
            $lastHoverHighlight.remove();
            $lastHoverHighlight = null;
        }
        if (id != null) {
            var obj = objs[id];
            // var views = _.filter(getListeners(obj), function (listener) {
            //     return listener.bbvistype === 'view';
            // });
            // var $els = $(_.pluck(views, 'el'));
            if (obj && obj.$el) {
                $lastHoverHighlight = highlight(obj.$el, { opacity: 0.4 });
            }
        }
    }

    function isActiveView (obj) {
        return (obj.$el || $(obj.el)).closest('body').length
    }

    function post(obj, msg, force) {
        var m = _.clone(msg || {});
        m.isView = obj.bbvistype === 'view';
        if (m.isView) {
            m.isActiveView = !!isActiveView(obj);
        }
        m.id = getId(obj);
        m.name = getName(obj);
        var parallel = getObjParallel(obj);
        if (parallel.waiting != null) {
            m.waiting = !!parallel.waiting;
        }
        var data;
        // Adapted from https://github.com/douglascrockford/JSON-js/blob/master/cycle.js
        function serialize (input) {
            // On at least one site, the decycle stuff doesn't work right, so in that
            // case maxItems prevents stack overflow.
            var MAX_ARRAY_LENGTH = 10;
            var maxItems = 2000;
            var seen = [];
            return JSON.stringify(input, function (key, value) {
                if (maxItems-- < 0) {
                    return "<< BBVis: Max Item Limit Reached >>";
                }
                if (typeof value === 'object' && value !== null &&
                        !(value instanceof Boolean) &&
                        !(value instanceof Date)    &&
                        !(value instanceof Number)  &&
                        !(value instanceof RegExp)  &&
                        !(value instanceof String)) {
                    if (seen.indexOf(value) >= 0) {
                        return "<< BBVis: Duplicate Ref Removed >>";
                    }
                    seen.push(value);
                }
                if (value && value.push && value.length > MAX_ARRAY_LENGTH) {
                    var a = value.slice(0, MAX_ARRAY_LENGTH);
                    a.push('... ' + (value.length - MAX_ARRAY_LENGTH) + ' more');
                    return a;
                } else {
                    return value;
                }
            });
        }
        try {
            data = parallel.data && serialize(parallel.data);
        } catch(e) {
            data = JSON.stringify('BBVis Error - Could not serialize object data: ' + e);
        }
        delete parallel.data;
        if (data && (force || data !== parallel.last_data)) {
            m.data = data;
            parallel.last_data = data;
        }
        var str = JSON.stringify(m);
        // Don't send data that is already up-to-date
        if (force || lastmsg[m.id] !== str) {
            lastmsg[m.id] = str;
            // console.log('post ' + m.id + ', ' + m.waiting);
            window.postMessage({ bbvis: m }, location.href);
            return true;
        }
        return false;
    }

    function getId(obj) {
        obj = getObj(obj);
        if (!obj.__bbvisid__) {
            var id = obj.__bbvisid__ = nextId++;
            if (!objs[id]) {
                objs[id] = obj;
                if (nameProperties !== undefined) {
                    guessNameProperties();
                }
            }
            setDirty(obj);
            // If we've already guessed names before, maybe try again
        }
        return obj.__bbvisid__;
    }

    function getObjParallel(obj) {
        var id = getId(obj);
        if (!objParallels[id]) {
            objParallels[id] = new ObjParallel(obj);
        }
        return objParallels[id];
    }

    var guessNameProperties = function() {
        setAllDirty();
        var possiblities = {};
        var realObjs = _.map(_.values(objs), getObj);
        _.each(realObjs, function(obj) {
            for (var k in obj) {
                if (typeof obj[k] === 'string') {
                    if (!possiblities[k]) {
                        possiblities[k] = [];
                    }
                    possiblities[k].push(obj[k]);
                }
            }
        });
        delete possiblities.cid;
        delete possiblities.bbvistype;
        var props = _.keys(possiblities);
        var okayNames = _.filter(props, function (prop) {
            return _.uniq(possiblities[prop]).length > 1;
        });
        var bestNames = _.sortBy(okayNames, function (prop) {
            return _.uniq(possiblities[prop]).length;
        })
        bestNames.reverse();
        bestNames.push('cid'); // fall back to cid if there's nothing unique
        nameProperties = bestNames;
    };

    var nameProperties;
    function getName(o) {
        if (nameProperties === undefined) {
            guessNameProperties();
        }

        var keys = 'name Name title Title id Id ID'.split(' ');
        var strKey = _.find(nameProperties, function (key) {
            return typeof o[key] === 'string';
        });
        var name = 'no name';
        if (strKey) {
            name = o[strKey];
        } else {
            var fnKey = _.find(keys, function (key) {
                return typeof o[key] === 'function';
            });
            if (fnKey) {
                name = o[fnKey].call(o);
            }
        }
        var id;
        if (o.get) {
            var arg;
            var args = 'name Name title Title id Id ID'.split(' ');
            if (o.idAttribute != null) {
                args.unshift(o.idAttribute);
            }
            while (id == null && (arg = args.shift())) {
                id = o.get(arg);
            }
            if (id != null) {
                name = name + '#' + id;
            }
        }
        return name;
    }

    function setDirty(obj, force) {
        var id = getId(obj);
        dirty[id] = force;
        if (!cleanTimer) {
            cleanTimer = setTimeout(clean, 20);
        }
    }

    function setAllDirty (force) {
        for (var id in objs) {
            setDirty(objs[id], force);
        }
    }

    function setAllViewsDirty () {
        for (var id in objs) {
            if (objs[id].bbvistype === 'view') {
                setDirty(objs[id]);
            }
        }
    }

    function add(obj) {
        getId(obj);
    }

    function clean() {
        cleanTimer = null;
        if (paused) {
            return;
        }
        var num = 0;
        var numSent = 0;
        var cleaned = [];
        var t = new Date().getTime();
        for (var id in dirty) {
            if (new Date().getTime() - t > 1) {
                if (!cleanTimer) {
                    cleanTimer = setTimeout(clean, 1);
                }
                break;
            }
            num++;
            var obj = objs[id];
            var parallel = getObjParallel(obj);
            var listeners = _.map(getListeners(obj), getId);
            // Only send the new info if this is a view, if this has listeners,
            // or if this no longer has any listeners.
            parallel.sendEnabled = (
                (obj.bbvistype === 'view') ||
                (listeners.length > 0) ||
                (parallel.hadListeners && listeners.length === 0));
            if (parallel.sendEnabled) {
                listeners.sort();
                var force = dirty[id] === true;
                if (post(obj, { listeners: listeners }, force)) {
                    numSent++;
                }
            }
            parallel.hadListeners = listeners.length > 0;
            cleaned.push(id);
        }
        for (var i = 0; i < cleaned.length; i++) {
            delete dirty[cleaned[i]];
        }
        // console.log('cleaned ' + num + ', sent ' + numSent);
    }

    function init() {

        // We can't do this until now because underscore won't be available
        // on initial load.
        guessNameProperties = _.debounce(guessNameProperties, 1000, true);

        Backbone.Model.prototype.bbvistype = 'model';
        Backbone.View.prototype.bbvistype = 'view';
        Backbone.Collection.prototype.bbvistype = 'collection';

        function wrap(proto, method, wrapperBefore, wrapperAfter) {
            var orig = proto[method];
            proto[method] = function() {
                wrapperBefore.apply(this, arguments);
                var rval = orig.apply(this, arguments);
                if (wrapperAfter) {
                    wrapperAfter.call(this, rval);
                }
                return rval;
            };
        }

        wrap(Backbone.Model.prototype, 'on', function(event, cb, context) {
            if (getObj(this)) { setDirty(getObj(this)); }
            if (getObj(context)) { add(getObj(context)); }
        });

        wrap(Backbone.Model.prototype, 'off', function(event, cb, context) {
            if (getObj(this)) { setDirty(getObj(this)); }
            if (getObj(context)) { add(getObj(context)); }
        });

        wrap(Backbone.Model.prototype, 'fetch', function () {
            if (getObj(this)) {
                getObjParallel(this).waiting = true;
                // console.log('fetching ' + getId(this));
                setDirty(getObj(this));
            }
        });

        wrap(Backbone.Model.prototype, 'set', function () {}, function () {
            if (getObj(this)) {
                if (getObjParallel(this).waiting != null) {
                    getObjParallel(this).waiting = false;
                }
                getObjParallel(this).data = this.toJSON();
                getObjParallel(this).ping();
                setDirty(this);
            }
        });

        // Use the call to _configure during View construction to wrap render
        wrap(Backbone.View.prototype, '_configure', function() {
            // on render, mark everything dirty, because views could have changed and active flags could all be obsolete
            wrap(this, 'render', function() {
                if (getObj(this)) { getObjParallel(this).ping(); }
                setAllViewsDirty();
            });
        });

        window.addEventListener('message', function(msg) {
            var bbvisMsg = msg && msg.data && msg.data.bbvis;
            if (bbvisMsg) {
                if (bbvisMsg.resend) {
                    paused = false;
                    lastmsg = {};
                    // console.log('BBVis: Resending data to devtools.');
                    setAllDirty(true);
                }
                if (bbvisMsg.pause) {
                    paused = true;
                    // console.log('BBVis: pause.');
                }
                if (bbvisMsg.hover !== undefined) {
                    // console.log('hover ' + bbvisMsg.hover);
                    hover(bbvisMsg.hover);
                }
            }
        }, false);
    }

}());
