
(function () {
    var SEND_ALL = false;
    var HIDE_TBONE_ROOT = false; // temp kludge for drawing pretty pictures

    if (!String.prototype.toJSON) {
        String.prototype.toJSON = function () {
            return '"' + this + '"';
        };
    }

    var messages = [];
    function send(msg) {
        // messages.push(msg);
        window.postMessage({ bbvis: msg }, location.href);
    }

    window.bbvis_getmessages = function () {
        // console.log('sending ' + messages.length + ' messages');
        var msgs = messages;
        messages = [];
        return msgs;
    };

    window.bbvis_send = function (msg) {
        // console.log('received', msg);
        receive(msg);
    };

    function receive(msg) {
        if (msg.resend) {
            paused = false;
            lastmsg = {};
            console.log('BBVis: Resending data to devtools.');
            setAllDirty(true);
        }
        if (msg.pause) {
            paused = true;
            console.log('BBVis: pause.');
        }
        if (msg.hover !== undefined) {
            // console.log('hover ' + msg.hover);
            hover(msg.hover);
        }
    }

    var initted = false;
    var bbInitted = false;
    var tboneInitted = false;
    function tryInit () {
        if (!initted) {
            init();
            initted = true;
            send({ loaded: true });
        }
    }

    function instrumentBackbone () {
        if (!bbInitted && window.Backbone) {
            tryInit();
            bbInitted = true;
            document.removeEventListener('load', instrumentBackbone);
            wrapmodel(Backbone.Model.prototype);
            wrapcollection(Backbone.Collection.prototype);
            wrapview(Backbone.View.prototype);
            console.log('BBVis: Backbone instrumented.');
        }
    }
    document.addEventListener('load', instrumentBackbone, true);

    function instrumentTBone () {
        if (!tboneInitted) {
            tryInit();
            tboneInitted = true;
            window.removeEventListener('tbone_loaded', instrumentTBone);
            wrapmodel(tbone.models.base);
            wrapmodel(tbone.models.bound);
            wrapmodel(tbone.models.async);
            wrapmodel(tbone.models.ajax);
            wrapmodel(tbone);
            wrapcollection(tbone.collections.base);
            wrapview(tbone.views.base);
            console.log('BBVis: TBone instrumented.');
        }
    }
    window.addEventListener('tbone_loaded', instrumentTBone, false);

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

    function isFunction (x) {
        return typeof x === 'function';
    }

    function isQueryable(x) {
        return !!(x && typeof x['query'] === 'function');
    }

    function getListeners(self) {
        var listeners = [];
        function add(context) {
            var listener = getObj(context);
            if (listener) {
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
        // TBone-native:
        if (isQueryable(self) && isFunction(self)) {
            var stack = [ self['_events'] ];
            var next, callbacks, k;

            while (!!(next = stack.pop())) {
                for (k in next) {
                    if (k === '') {
                        callbacks = next[''];
                        for (var i = 0; i < next[''].length; i++) {
                            if (callbacks[i].context) {
                                listeners.push(callbacks[i].context);
                            }
                        }
                    } else {
                        stack.push(next[k]);
                    }
                }
            }
        }
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
                send({ id: this.id, ping: true });
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
            send(m);
            return true;
        }
        return false;
    }

    function getId(obj) {
        obj = getObj(obj);
        if (obj && !obj.__bbvisid__) {
            var id = obj.__bbvisid__ = nextId++;
            if (!objs[id]) {
                objs[id] = obj;
            }
            setDirty(obj);
            // If we've already guessed names before, maybe try again
        }
        return obj ? obj.__bbvisid__ : null;
    }

    function getObjParallel(obj) {
        var id = getId(obj);
        if (!objParallels[id]) {
            objParallels[id] = new ObjParallel(obj);
        }
        return objParallels[id];
    }

    function getName(o) {
        return (o && o.Name) || 'no name';
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
            var listeners = getListeners(obj);

            /**
             * If the only binding for a model is from its own collection,
             * don't publish that; this happens automatically in Backbone.
             **/
            if (listeners.length === 1 && listeners[0] === obj.collection) {
                listeners = [];
            }

            var listenerIds = _.map(listeners, getId);
            var hasListeners = listeners.length > 0;

            // Only send the new info if this is a view, if this has listeners,
            // or if this no longer has any listeners.
            parallel.sendEnabled =
                SEND_ALL ||
                obj.bbvistype === 'view' ||
                parallel.hadListeners ||
                hasListeners;

            if (obj.tboneid === 1 && HIDE_TBONE_ROOT) {
                parallel.sendEnabled = false;
            }

            if (parallel.sendEnabled) {
                listenerIds.sort();
                var force = dirty[id] === true;
                if (post(obj, { listeners: listenerIds }, force)) {
                    numSent++;
                }
            }
            parallel.hadListeners = hasListeners;
            cleaned.push(id);
        }
        for (var i = 0; i < cleaned.length; i++) {
            delete dirty[cleaned[i]];
        }
        // console.log('cleaned ' + num + ', sent ' + numSent);
    }

    function init() {
        window.addEventListener('message', function(msg) {
            var bbvisMsg = msg && msg.data && msg.data.bbvis;
            if (bbvisMsg) {
                receive(bbvisMsg);
            }
        }, false);

    }

    function wrap(proto, method, wrapperBefore, wrapperAfter) {
        if (proto) {
            var orig = proto[method];
            if (orig) {
                proto[method] = function() {
                    wrapperBefore.apply(this, arguments);
                    var rval = orig.apply(this, arguments);
                    if (wrapperAfter) {
                        wrapperAfter.call(this, rval);
                    }
                    return rval;
                };
            }
        }
    }

    function wrapmodel (model) {
        model.bbvistype = 'model';

        _.each(['on', 'off'], function (op) {
            wrap(model, op, function(event, cb, context) {
                if (getObj(this)) { setDirty(getObj(this)); }
                if (getObj(context)) { add(getObj(context)); }
            });
        });

        wrap(model, 'fetch', function () {
            if (getObj(this)) {
                getObjParallel(this).waiting = true;
                // console.log('fetching ' + getId(this));
                setDirty(getObj(this));
            }
        });

        _.each(['set', 'query', 'push'], function (op) {
            wrap(model, op, function (prop, data) {
                if (data && isQueryable(data)) {
                    add(getObj(data));
                }
            }, function () {
                if (getObj(this)) {
                    if (getObjParallel(this).waiting != null) {
                        getObjParallel(this).waiting = false;
                    }
                    getObjParallel(this).data = this.attributes;
                    getObjParallel(this).ping();
                    setDirty(this);
                }
            });
        });
    }

    function wrapcollection (collection) {
        collection.bbvistype = 'collection';
    }

    function wrapview (view) {
        view.bbvistype = 'view';

        // Use the call to _configure during View construction to wrap render
        wrap(view, '_configure', function() {
            // on render, mark everything dirty, because views could have changed and active flags could all be obsolete
            wrap(this, 'render', function() {
                if (getObj(this)) { getObjParallel(this).ping(); }
                setAllViewsDirty();
            });
        });
    }

}());
