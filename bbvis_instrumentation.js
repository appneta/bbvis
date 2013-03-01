(function () {

    var initted = false;
    document.addEventListener('load', function instrumentBackbone(ev) {
        if (window.Backbone && !initted) {
            document.removeEventListener('load', instrumentBackbone);
            init();
            console.log('BBVis: Backbone instrumented.');
            initted = true;
        }
    }, true);

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

    function getListeners(obj) {
        var listeners = [];
        _.each(_.values(obj._callbacks || {}), function (ll) {
            var curr = ll.next;
            while (true) {
                if (curr && curr.context) {
                    var listener = getObj(curr.context);
                    /**
                     * Don't publish event binding of collections to their
                     * own models; this happens automatically in backbone.
                     **/
                    if (listener && listener !== obj.collection) {
                        listeners.push(listener);
                    }
                    curr = curr.next;
                } else {
                    break;
                }
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

    function ObjParallel (obj) {
        this.id = getId(obj);
        this.obj = getObj(obj);
        this.data = "(no data)";

        this.ping = _.debounce(function () {
            if (this.sendEnabled) {
                // console.log('ping ' + this.id);
                window.postMessage({ bbvis: { id: this.id, ping: true } }, location.href);
            }
        }, 200);
    }

    function post(obj, msg, force) {
        var m = _.clone(msg || {});
        m.isView = obj.bbvistype === 'view';
        if (m.isView) {
            m.isActiveView = !!(obj.$el || $(obj.el)).closest('body').length;
        }
        m.id = getId(obj);
        m.name = getName(obj);
        var parallel = getObjParallel(obj);
        if (parallel.waiting != null) {
            m.waiting = !!parallel.waiting;
        }
        var data;
        try {
            var MAX_ARRAY_LENGTH = 20;
            data = parallel.data && JSON.stringify(parallel.data, function (key, value) {
                if (value && value.push && value.length > MAX_ARRAY_LENGTH) {
                    var a = value.slice(0, MAX_ARRAY_LENGTH);
                    a.push('... ' + (value.length - MAX_ARRAY_LENGTH) + ' more');
                    return a;
                } else {
                    return value;
                }
            });
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
            objs[id] = obj;
            setDirty(obj);
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

    function getName(o) {
        var keys = 'name Name id ID Id'.split(' ');
        var strKey = _.find(keys, function (key) {
            return typeof o[key] === 'string';
        });
        if (strKey) {
            return o[strKey];
        } else {
            var fnKey = _.find(keys, function (key) {
                return typeof o[key] === 'function';
            });
            if (fnKey) {
                return o[fnKey].call(o);
            } else {
                return 'no name';
            }
        }
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
            parallel.sendEnabled = (obj.bbvistype === 'view') || (listeners.length > 0);
            if (parallel.sendEnabled) {
                listeners.sort();
                var force = dirty[id] === true;
                if (post(obj, { listeners: listeners }, force)) {
                    numSent++;
                }
            }
            cleaned.push(id);
        }
        for (var i = 0; i < cleaned.length; i++) {
            delete dirty[cleaned[i]];
        }
        // console.log('cleaned ' + num + ', sent ' + numSent);
    }

    function init() {

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

        var origOn = Backbone.Model.prototype.on;
        wrap(Backbone.Model.prototype, 'on', function(event, cb, context) {
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
            if (msg && msg.data && msg.data.bbvis === 'resend all') {
                lastmsg = {};
                console.log('BBVis: Resending data to devtools.');
                setAllDirty(true);
            }
        }, false);
    }

}());
