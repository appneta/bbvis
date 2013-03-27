(function () {
/** @const {boolean} */
var TBONE_DEBUG = window['TBONE_DEBUG'];

var tbone = function (arg0, arg1, arg2) {
    if (arg0) {
        if (typeof arg0 === 'function') {
            return autorun(arg0, arg1, arg2);
        } else if (typeof arg1 === 'function') {
            return autorun(function () {
                T(arg0, arg1());
            });
        } else {
            return lookup.apply(this, arguments);
        }
    }
    /**
     * Does anything make sense to do with no arguments?
     */
};
var models = {};
var collections = {};
var templates = {};
var views = {};

/**
 * Scheduling priority constants
 *
 * The scheduler will update views and models in this order:
 * 1) synchronous (local) models
 * 2) views
 * 3) asynchronous (ajax) models
 *
 * The goals of this ordering are:
 * - never render a view based on an outdated model that
 *   we can update immediately.
 * - defer ajax requests until we know that something in the
 *   UI needs its data.
 */
/** @const */
var BASE_PRIORITY_MODEL_SYNC = 3000;
/** @const */
var BASE_PRIORITY_VIEW = 2000;
/** @const */
var BASE_PRIORITY_MODEL_ASYNC = 1000;
/**
 * We also use the processQueue to initialize models & views.  By adding this delta
 * to priorities for initialization, we ensure that initialization happens in the
 * same order as execution and that it happens before execution.  For example, it
 * may be inefficient for a model to reset before a model that it depends on has
 * initialized, as dependency chains will not yet be established.
 * XXX Does this really matter?  Or matter much?
 * @const
 */
var PRIORITY_INIT_DELTA = 5000;

function identity(x) { return x; }
/** @const */
function noop () { return null; }

function isfunction (x) {
    return typeof x === 'function';
}

function isString(x) {
    return typeof x === 'string';
}

/**
 * Returns a function that returns the elapsed time.
 * @return {function(): Number} Function that returns elapsed time.
 */
function timer() {
    var start = new Date().getTime();
    /**
     * Function that returns elapsed time since the outer function was invoked.
     * @return {Number} Elapsed time in ms
     */
    return function () {
        return new Date().getTime() - start;
    };
}

function warn() {
    if (TBONE_DEBUG) {
        console.warn.apply(console, arguments);
    }
}
function error() {
    if (TBONE_DEBUG) {
        console.error.apply(console, arguments);
    }
}

/** @const */
var ERROR = 1;
/** @const */
var WARN = 2;
/** @const */
var INFO = 3;
/** @const */
var VERBOSE = 4;

var logLevels = {
    type: {

    },
    context: {

    },
    event: {

    },
    base: WARN
};
if (TBONE_DEBUG) {
    tbone['watchLog'] = function (name, level) {
        if (level == null) { level = VERBOSE; }
        logLevels.type[name] = VERBOSE;
        logLevels.context[name] = VERBOSE;
        logLevels.event[name] = VERBOSE;
    };
}

var events = [];

var viewRenders = 0;

/**
 * Dynamic counter of how many ajax requests are inflight.
 * @type {Number}
 */
var inflight = 0;

tbone['isReady'] = function () {
    return !inflight && !schedulerQueue.length;
};

var logCallbacks = [];

function log () {
    if (TBONE_DEBUG) {
        for (var i = 0; i < logCallbacks.length; i++) {
            logCallbacks[i].apply(this, arguments);
        }
    }
}

/**
 * Log an event.  The event is piped to the JS console if the level is less than or equal to the
 * matched maximum log level based on the logLevels configuration above.
 * @param  {Number}                                    level   Log level: 1=error, 2=warn, 3=info, 4=verbose
 * @param  {string|Backbone.Model|Backbone.View|Scope} context What is logging this event
 * @param  {string}                                    event   Short event type string
 * @param  {string|Object}                             msg     Message string with tokens that will be
 *                                                             rendered from data.  Or just relevant data.
 * @param  {Object=}                                   data    Relevant data
 */
function logconsole (level, context, event, msg, data) {
    var name = isString(context) ? context : context.name;
    var type = (isString(context) ? context :
                context.isModel ? 'model' :
                context.isView ? 'view' :
                context.isScope ? 'scope' : '??');
    var threshold = Math.max(logLevels.context[name] || 0,
                             logLevels.event[event] || 0,
                             logLevels.type[type] || 0) || logLevels.base;
    if (event === 'lookups') {
        msg = _.reduce(msg, function(memo, map, id) {
            memo[map.__path__] = map;
            return memo;
        }, {});
    }
    if (level <= threshold) {
        /**
         * If a msg is a string, render it as a template with data as the data.
         * If msg is not a string, just output the data below.
         */
        var templated = isString(msg) ? _.template(msg, data || {}) : '';
        var includeColon = !!templated || !!msg;
        var frame = type === name ? type : (type + ' ' + name);
        var message = frame + ' / ' + event + (includeColon ? ': ' : '');
        var logfn = console[(level === ERROR ? 'error' : level === WARN ? 'warn' : 'log')];
        logfn.call(console, message, templated || msg || '');
    }
}

function onLog (cb) {
    logCallbacks.push(cb);
}
if (TBONE_DEBUG) {
    tbone['onLog'] = onLog;
    onLog(logconsole);
}

/**
 * Returns the list of unique listeners attached to the specified model/view.
 * @param  {Backbone.Model|Backbone.View} self
 * @return {Array.<Backbone.Model|Backbone.View|Scope>} array of listeners
 */
function getListeners(self) {
    var listeners = [];
    // Older backbone:
    _.each(_.values(self['_callbacks'] || {}), function (ll) {
        var curr = ll.next;
        while (true) {
            if (curr.context) {
                listeners.push(curr.context);
                curr = curr.next;
            } else {
                break;
            }
        }
    });
    // Newer backbone:
    _.each(_.flatten(_.values(self['_events'] || {})), function (ev) {
        if (ev.context) {
            listeners.push(ev.context);
        }
    });
    return _.uniq(listeners);
}

/**
 * Returns true if there is a view that is listening (directly or indirectly)
 * to this model.  Useful for determining whether the current model should
 * be updated (if a model is updated in the forest and nobody is there to
 * hear it, then why update it in the first place?)
 * @param  {Backbone.Model|Backbone.View}  self
 * @return {Boolean}
 */
function hasViewListener(self) {
    var todo = [];
    var usedModels = {};
    todo.push(self);
    usedModels[self.name] = true;
    while (todo.length) {
        var next = todo.pop();
        var listeners = getListeners(next);
        for (var i = 0; i < listeners.length; i++) {
            var listener = listeners[i];
            if (listener.isScope) {
                // The listener context is the model or view to whom the scope belongs.
                // Here, we care about that model/view, not the scope, because that's
                // what everyone else might be listening to.
                listener = listener.context;
            }
            // listener might be undefined right now if the scope above didn't have a context.
            if (listener) {
                if (listener.isView) {
                    // We found a view that depends on the original model!
                    return true;
                }
                // listener could also have been a scope with a context that was neither
                // a model nor a view.
                if (listener.isModel) {
                    var name = listener['name'];
                    if (name && !usedModels[listener.name]) {
                        todo.push(listener);
                        usedModels[name] = true;
                    }
                }
            }
        }
    }
    return false;
}

/**
 * currentParentScope globally tracks the current executing scope, so that subscopes
 * created during its execution (i.e. by tbone.autorun) can register themselves as
 * subscopes of the parent (this is important for recursive destruction of scopes).
 */
var currentParentScope;

/**
 * An autobinding function execution scope.  See autorun for details.
 * @constructor
 */
function Scope(fn, context, priority, name, onExecuteCb, onExecuteContext) {
    _.extend(this, {
        fn: fn,
        context: context,
        priority: priority,
        name: name,
        onExecuteCb: onExecuteCb,
        onExecuteContext: onExecuteContext,
        subScopes: []
    });
}

_.extend(Scope.prototype,
    /** @lends {Scope.prototype} */ {
    /**
     * Used to identify that an object is a Scope
     * @type {Boolean}
     */
    isScope: true,
    /**
     * Queue function execution in the scheduler
     */
    trigger: function () {
        queueExec(this);
    },
    /**
     * Execute the wrapped function, tracking all values referenced through lookup(),
     * and binding to those data sources such that the function is re-executed whenever
     * those values change.  Each execution re-tracks and re-binds all data sources; the
     * actual sources bound on each execution may differ depending on what is looked up.
     */
    execute: function () {
        var self = this;
        if (!self.destroyed) {
            self.unbindAll();
            self.destroySubScopes();
            // Save our parent's lookups and subscopes.  It's like pushing our own values
            // onto the top of each stack.
            var oldLookups = recentLookups;
            this.lookups = recentLookups = {};
            var oldParentScope = currentParentScope;
            currentParentScope = self;

            // ** Call the payload function **
            // This function must be synchronous.  Anything that is looked up using
            // tbone.lookup before this function returns (that is not inside a subscope)
            // will get bound below.
            self.fn.call(self.context);

            _.each(recentLookups, function (propMap) {
                var obj = propMap['__obj__'];
                if (obj.isCollection) {
                    /**
                     * This is not as efficient as it could be.
                     */
                    obj.on('add remove reset', self.trigger, self);
                } else {
                    if (propMap['*']) {
                        obj.on('change', self.trigger, self);
                    } else {
                        for (var prop in propMap) {
                            if (prop !== '__obj__' && prop !== '__path__') {
                                obj.on('change:' + prop, self.trigger, self);
                            }
                        }
                    }
                }
            });

            // This is intended primarily for diagnostics.  onExecute may either be a
            // function, or an array with a function and a context to use for the
            // function call.  In either case, this Scope is passed as the only argument.
            if (self.onExecuteCb) {
                self.onExecuteCb.call(self.onExecuteContext, this);
            }

            // Pop our own lookups and parent scope off the stack, restoring them to
            // the values we saved above.
            recentLookups = oldLookups;
            currentParentScope = oldParentScope;
        }
    },
    /**
     * For each model which we've bound, tell it to unbind all events where this
     * scope is the context of the binding.
     */
    unbindAll: function () {
        var self = this;
        _.each(this.lookups || {}, function (propMap) {
            propMap['__obj__'].off(null, null, self);
        });
    },
    /**
     * Destroy any execution scopes that were creation during execution of this function.
     */
    destroySubScopes: function () {
        _.each(this.subScopes, function (subScope) {
            subScope.destroy();
        });
        this.subScopes = [];
    },
    /**
     * Destroy this scope.  Which means to unbind everything, destroy scopes recursively,
     * and ignore any execute calls which may already be queued in the scheduler.
     */
    destroy: function () {
        this.destroyed = true;
        this.unbindAll();
        this.destroySubScopes();
    }
});

/**
 * tbone.autorun
 *
 * Wrap a function call with automatic binding for any model properties accessed
 * during the function's execution.
 *
 * Models and views update automatically by wrapping their reset functions with this.
 *
 * Additionally, this can be used within postRender callbacks to section off a smaller
 * block of code to repeat when its own referenced properties are updated, without
 * needing to re-render the entire view.
 * @param  {Function}                       fn        Function to invoke
 * @param  {Backbone.Model|Backbone.View}   context   Context to pass on invocation
 * @param  {number}                         priority  Scheduling priority - higher = sooner
 * @param  {string}                         name      Name for debugging purposes
 * @return {Scope}                                    A new Scope created to wrap this function
 */
function autorun(fn, context, priority, name, onExecuteCb, onExecuteContext, detached) {
    // Default priority and name if not specified.  Priority is important in
    // preventing unnecessary refreshes of views/subscopes that may be slated
    // for destruction by a parent; the parent should have priority so as
    // to execute first.
    if (!priority) {
        priority = currentParentScope ? currentParentScope.priority - 1 : 0;
    }
    if (!name) {
        name = currentParentScope ? currentParentScope.name + '+' : 'unnamed';
    }

    // Create a new scope for this function
    var scope = new Scope(fn, context, priority, name, onExecuteCb, onExecuteContext);

    // If this is a subscope, add it to its parent's list of subscopes.
    if (!detached && currentParentScope) {
        currentParentScope.subScopes.push(scope);
    }

    // Run the associated function (and bind associated models)
    scope.execute();

    // Return the scope object; this is used by BaseView to destroy
    // scopes when the associated view is destroyed.
    return scope;
}

/**
 * Generate and return a unique identifier which we attach to an object.
 * The object is typically a view, model, or scope, and is used to compare
 * object references for equality using a hash Object for efficiency.
 * @param  {Object} obj Object to get id from ()
 * @return {string}     Unique ID assigned to this object
 */
function uniqueId(obj) {
    return obj['tboneid'] = obj['tboneid'] || nextId++;
}
var nextId = 1;

/**
 * List of Scopes to be executed immediately.
 * @type {Array.<Scope>}
 */
var schedulerQueue = [];

/**
 * Flag indicating that the schedulerQueue is unsorted.
 * @type {Boolean}
 */
var dirty;

/**
 * Hash map of all the current Scope uniqueIds that are already
 * scheduled for immediate execution.
 * @type {Object.<string, Boolean>}
 */
var scopesQueued = {};

/**
 * Pop the highest priority Scope from the schedulerQueue.
 * @return {Scope} Scope to be executed next
 */
function pop() {
    /**
     * The schedulerQueue is lazily sorted using the built-in Array.prototype.sort.
     * This is not as theoretically-efficient as standard priority queue algorithms,
     * but Array.prototype.sort is fast enough that this should work well enough for
     * everyone, hopefully.
     */
    if (dirty) {
        schedulerQueue.sort(function (a, b) {
            /**
             * TODO for sync models, use dependency graph in addition to priority
             * to order execution in such a way as to avoid immediate re-execution.
             */
            return a.priority - b.priority;
        });
        dirty = false;
    }
    return schedulerQueue.pop();
}

/**
 * Flag indicating whether a processQueue timer has already been set.
 */
var processQueueTimer;

/**
 * Queue the specified Scope for execution if it is not already queued.
 * @param  {Scope}   scope
 */
function queueExec (scope) {
    var contextId = uniqueId(scope);
    if (!scopesQueued[contextId]) {
        scopesQueued[contextId] = true;

        /**
         * Push the scope onto the queue of scopes to be executed immediately.
         */
        schedulerQueue.push(scope);

        /**
         * Mark the queue as dirty; the priority of the scope we just added
         * is not immediately reflected in the queue order.
         */
        dirty = true;

        /**
         * If a timer to process the queue is not already set, set one.
         */
        if (!processQueueTimer && unfrozen) {
            processQueueTimer = _.defer(processQueue);
        }
    }
}

var unfrozen = true;

/**
 * Drain the Scope execution queue, in priority order.
 */
function processQueue () {
    processQueueTimer = null;
    var queueProcessTime = timer();
    var scope;
    while (unfrozen && !!(scope = pop())) {
        /**
         * Update the scopesQueued map so that this Scope may be requeued.
         */
        delete scopesQueued[uniqueId(scope)];

        var scopeExecTime;
        if (TBONE_DEBUG) {
            scopeExecTime = timer();
        }

        /**
         * Execute the scope, and in turn, the wrapped function.
         */
        scope.execute();

        if (TBONE_DEBUG) {
            var executionTimeMs = scopeExecTime();
            log(VERBOSE, 'scheduler', 'exec', '<%=priority%> <%=duration%>ms <%=name%>', {
                'priority': scope.priority,
                'name': scope.name,
                'duration': executionTimeMs
            });
            if (executionTimeMs > 10) {
                log(VERBOSE, 'scheduler', 'slowexec', '<%=priority%> <%=duration%>ms <%=name%>', {
                    'priority': scope.priority,
                    'name': scope.name,
                    'duration': executionTimeMs
                });
            }
        }
    }
    log(VERBOSE, 'scheduler', 'processQueue', 'ran for <%=duration%>ms', {
        'duration': queueProcessTime()
    });
    log(VERBOSE, 'scheduler', 'viewRenders', 'rendered <%=viewRenders%> total', {
        'viewRenders': viewRenders
    });
}
/**
 * Drain to the tbone processQueue, processing all scope executes immediately.
 * This is useful both for testing and MAYBE also for optimizing responsiveness by
 * draining at the end of a keyboard / mouse event handler.
 */
tbone['drain'] = function () {
    if (processQueueTimer) {
        clearTimeout(processQueueTimer);
    }
    processQueue();
};

tbone['freeze'] = function () {
    unfrozen = false;
};


Backbone.Model.prototype.isModel = true;

/**
 * baseModel
 * @constructor
 * @extends Backbone.Model
 */
var baseModel = Backbone.Model.extend({
    /**
     * Constructor function to initialize each new model instance.
     * @return {[type]}
     */
    initialize: function () {
        var self = this;
        uniqueId(self);
        var isAsync = self.sleeping = self.isAsync();
        var priority = isAsync ? BASE_PRIORITY_MODEL_ASYNC : BASE_PRIORITY_MODEL_SYNC;
        /**
         * Queue the autorun of update.  We want this to happen after the current JS module
         * is loaded but before anything else gets updated.  We can't do that with setTimeout
         * or _.defer because that could possibly fire after processQueue.
         */
        queueExec({
            execute: function () {
                self.scope = autorun(self.update, self, priority, 'model_' + self.name,
                                     self.onScopeExecute, self);
            },
            priority: priority + PRIORITY_INIT_DELTA
        });
    },
    /**
     * Indicates whether this function should use the asynchronous or
     * synchronous logic.
     * @return {Boolean}
     */
    isAsync: function () {
        return !!this['_url'];
    },
    onScopeExecute: function (scope) {
        log(INFO, this, 'lookups', scope.lookups);
    },
    /**
     * Triggers scope re-execution.
     */
    reset: function () {
        if (this.scope) {
            this.scope.trigger();
        }
    },
    'isVisible': function () {
        return hasViewListener(this);
    },
    update: function () {
        var self = this;
        if (self.isAsync()) {
            self.updateAsync();
        } else {
            self.updateSync();
        }
    },
    updateAsync: function () {
        var self = this;
        var expirationSeconds = self['expirationSeconds'];
        function complete() {
            inflight--;
            delete self.__xhr;
            if (expirationSeconds) {
                if (self.expirationTimeout) {
                    clearTimeout(self.expirationTimeout);
                }
                self.expirationTimeout = setTimeout(function () {
                    self.reset();
                }, expirationSeconds * 1000);
            }
        }

        var url = self.url();
        var lastFetchedUrl = self.fetchedUrl;
        self.sleeping = !this['isVisible']();
        if (self.sleeping) {
            /**
             * Regardless of whether url is non-null, this model goes to sleep
             * if there's no view listener waiting for data (directly or through
             * a chain of other models) from this model.
             **/
            log(INFO, self, 'sleep');
            self.sleeping = true;
        } else if (url != null && (expirationSeconds || url !== lastFetchedUrl)) {
            /**
             * If a defined URL function returns null, it will prevent fetching.
             * This can be used e.g. to prevent loading until all required
             * parameters are set.
             **/
            self.fetchedUrl = url;
            self.clear();
            inflight++;
            self.fetch({
                'dataType': 'text',
                success: function () {
                    self['postFetch']();
                    self.trigger('fetch');
                    log(INFO, self, 'updated', self.toJSON());
                    complete();
                },
                error: function () {
                    complete();
                },
                'beforeSend': function (xhr) {
                    // If we have an active XHR in flight, we should abort
                    // it because we don't want that anymore.
                    if (self.__xhr) {
                        log(WARN, self, 'abort',
                            'aborting obsolete ajax request. old: <%=oldurl%>, new: <%=newurl%>', {
                            'oldurl': lastFetchedUrl,
                            'newurl': url
                        });
                        self.__xhr.abort();
                    }
                    self.__xhr = xhr;
                    xhr['__backbone__'] = true;
                },
                url: url
            });
        }
    },
    updateSync: function () {
        var self = this;
        // this.state returns the new state, synchronously
        var newParams = self['state']();
        if (newParams === null) {
            log(VERBOSE, self, 'update cancelled');
            return;
        }
        lookup.call(self, '__self__', newParams);
        log(INFO, self, 'updated', self.toJSON());
    },
    'state': noop,
    'postFetch': noop
});

/**
 * Create a new model type.
 * @param  {string}                   name Model name
 * @param  {Backbone.Model|Function=} base Parent model -- or state function of simple sync model
 * @param  {Object.<string, Object>=} opts Properties to override (optional)
 * @return {Backbone.Model}
 */
function createModel(name, base, opts) {
    if (TBONE_DEBUG && !isString(name)) {
        throw 'createModel requires name parameter';
    }
    /**
     * If only a name is provided, this is a passive model.  Disable autorun so that this model
     * will only be updated by set() calls.  This is useful in building simple dynamic data
     * sources for other models.
     */
    if (!base) {
        opts = {
            initialize: noop
        };
        base = baseModel;

    /**
     * If the second parameter is a function, use it as the state function of a simple sync model.
     */
    } else if (!base['__super__']) {
        opts = {
            'state': base
        };
        base = baseModel;
    }

    opts = _.extend({
        name: name
    }, opts || {});

    var model = models[name] = base.extend(opts);

    var modelPrototype = model.prototype;
    _.extend(model, /** @lends {model} */ {
        /**
         * Create and return an instance of this model using the model name as the instance name.
         * @return {Backbone.Model}
         */
        'singleton': function () {
            return this['make'](name);
        },
        /**
         * Create and return an instance of this model at tbone.data[instanceName].
         * @return {Backbone.Model}
         */
        'make': function (instanceName) {
            var instance = new model();
            if (instanceName) {
                lookup(instanceName, instance);
            }
            return instance;
        }
    });

    return model;
}

Backbone.Collection.prototype.isCollection = true;
var baseCollection = Backbone.Collection;

function createCollection(name, model) {
    if (TBONE_DEBUG && !isString(name)) {
        throw 'createCollection requires name parameter';
    }

    var opts = {
        name: name,
        model: model || baseModel
    };

    var collection = collections[name] = baseCollection.extend(opts);

    // XXX this is basically the same as in createModel.  Unify.
    var collectionPrototype = collection.prototype;
    _.extend(collection, /** @lends {collection} */ {
        'singleton': function () {
            return this['make'](name);
        },
        'make': function (instanceName) {
            var instance = new collection();
            if (instanceName) {
                lookup(instanceName, instance);
            }
            return instance;
        }
    });

    return collection;
}
var global = window;
var recentLookups;

/**
 * "Don't Get Data" - Special flag for lookup to return the model/collection instead
 * of calling toJSON() on it.
 * @const
 */
var DONT_GET_DATA = 1;

/**
 * "Iterate Over Models" - Special flag for lookup to return an iterator over the
 * models of the collection, enabling iteration over models, which is what we want
 * to do when using _.each(collection ...) in a template, as this allows us to
 * use model.lookup(...) and properly bind references to the models.
 * @const
 */
var ITERATE_OVER_MODELS = 2;

/**
 * "Extend on set" - instead of replacing an entire object or model's values on
 * set, extend that object/model instead.
 * @const
 */
var EXTEND_ON_SET = 3;

function lookup(flag, query, value) {
    var isSet;
    var dontGetData = flag === DONT_GET_DATA;
    var iterateOverModels = flag === ITERATE_OVER_MODELS;
    var extendOnSet = flag === EXTEND_ON_SET;
    if (!dontGetData && !iterateOverModels && !extendOnSet) {
        /**
         * If no flag provided, shift the query and value over.  We do it this way instead
         * of having flag last so that we can type-check flag and discern optional flags
         * from optional values.  And flag should only be used internally, anyway.
         */
        value = query;
        query = flag;
        flag = null;
        /**
         * Use arguments.length to switch to set mode in order to properly support
         * setting undefined.
         */
        if (arguments.length === 2) {
            isSet = true;
        }
    } else if (extendOnSet) {
        isSet = true;
    }

    var args = query.split('.');

    var setprop;
    if (isSet) {
        /**
         * For set operations, we only want to look up the parent of the property we
         * are modifying; pop the final property we're setting from args and save it
         * for later.
         * @type {string}
         */
        setprop = args.pop();
    }

    /**
     * If this function was called with a bindable context (i.e. a Model or Collection),
     * then use that as the root data object instead of the global tbone.data.
     */
    var last_data;
    var _data = (!this || !this['isBindable']) ? data : this;
    var name_parts = [];
    var myRootLookup;
    var myRecentLookup = {};
    var propAfterRecentLookup;
    var id;
    var arg;
    var foundBindable;
    if (_data['isBindable']) {
        id = uniqueId(_data);
        foundBindable = true;
        myRootLookup = myRecentLookup = (recentLookups && recentLookups[id]) || {
            '__obj__': _data
        };
    }
    while ((arg = args.shift()) != null && arg !== '__self__') {
        name_parts.push(arg);
        last_data = _data;
        if (_data['isBindable']) {
            foundBindable = true;
            if (_data.isModel) {
                _data = _data.get(arg);
            } else if (_data.isCollection) {
                // XXX should we support .get() for collections?  e.g. IDs starting with #?
                myRecentLookup[arg] = _data = _data.at(arg);
            }
            if (!propAfterRecentLookup) {
                propAfterRecentLookup = arg;
                myRecentLookup[arg] = _data;
            }
        } else {
            _data = _data[arg];
        }
        if (_data == null) {
            if (isSet) {
                /**
                 * When doing an implicit mkdir -p while setting a deep-nested property
                 * for the first time, we peek at the next arg and create either an array
                 * for a numeric index and an object for anything else.
                 */
                _data = rgxNumber.exec(args[0]) ? [] : {};
                if (last_data.isModel) {
                    last_data.set(arg, _data);
                } else if (last_data.isCollection) {
                    // XXX Maybe you just shouldn't do this?
                    log(ERROR, 'lookup', 'implicit deep nesting error',
                        "Don't implicitly set subproperties of collections.");
                    break;
                } else {
                    last_data[arg] = _data;
                }
            } else {
                break;
            }
        } else if (_data['isBindable']) {
            foundBindable = true;
            id = uniqueId(_data);
            myRecentLookup = (recentLookups && recentLookups[id]) || {
                '__obj__': _data,
                '__path__': name_parts.join('.') // XXX a model could exist at two paths]
            };
            if (recentLookups) {
                recentLookups[id] = myRecentLookup;
            }
            propAfterRecentLookup = null;
        }
    }

    /**
     * If we haven't found a model / collection in the process of looking something up,
     * log an error.  A common mistake could be to attempt to read values before models
     * are initialized.
     **/
    if (TBONE_DEBUG && !isSet && !foundBindable) {
        log(ERROR, 'lookup', 'no bindable found',
            'No model/collection found while looking up "<%=query%>".', {
            query: query
        });
    }

    /**
     * Only include the root lookup if there were no others.
     * XXX This is a good target for future optimization/improvement.
     **/
    if (recentLookups && myRootLookup && myRecentLookup === myRootLookup) {
        recentLookups[id] = myRootLookup;
    }

    if (_data) {
        if (isSet) {
            var currProp = (
                query === '__self__' ? _data : // only useful if _data is a model
                _data.isModel ? _data.get(setprop) :
                _data.isCollection ? _data.at(setprop) :
                _data[setprop]);

            if (currProp && currProp.isModel) {
                /**
                 * When setting to an entire model, we use different semantics; we want the
                 * values provided to be set to the model, not replace the model.
                 */
                if (value) {
                    /**
                     * Unless extendOnSet is set, remove any properties from the model that
                     * are not present in the value we're setting it to.  Extend-semantics
                     * are made available to the user via tbone.extend.
                     */
                    if (!extendOnSet) {
                        for (var k in currProp.toJSON()) {
                            if (value[k] === undefined) {
                                currProp.unset(k);
                            }
                        }
                    }
                    currProp.set(value);
                } else {
                    currProp.clear();
                }
            } else if (currProp !== value) {
                if (_data.isModel) {
                    /**
                     * Set the value to the top-level model property.  Common case.
                     */
                    _data.set(setprop, value);
                } else if (_data.isCollection) {
                    // XXX What makes sense to do here?
                } else if (_data[setprop] !== value) {
                    /**
                     * Set the value to a property on a regular JS object.
                     */
                    _data[setprop] = value;

                    /**
                     * If we're setting a nested property of a model (or collection?), then
                     * trigger a change event for the top-level property.
                     */
                    if (propAfterRecentLookup) {
                        myRecentLookup['__obj__'].trigger('change:' + propAfterRecentLookup);
                    }
                }
            }
            return undefined;
        } else if (iterateOverModels && _data.isCollection) {
            /**
             * If iterateOverModels is set and _data is a collection, return a list of models
             * instead of either the collection or a list of model data.  This is useful in
             * iterating over models while still being able to bind to models individually.
             */
            myRecentLookup['*'] = _data = _data.models;
        } else if (!dontGetData && _data['isBindable']) {
            /**
             * Unless dontGetData is specified, convert the model/collection to its data.
             * This is often what you want to do when getting data from a model, and this
             * is what is presented to the user via tbone/lookup.
             */
            myRecentLookup['*'] = _data = _data.toJSON();
        }
    }
    return _data;
}

function lookupText() {
    var value = lookup.apply(this, arguments);
    return value != null ? value : '';
}

function toggle(model_and_key) {
    lookup(model_and_key, !lookup(model_and_key));
}

function extend(prop, value) {
    return lookup.call(this, EXTEND_ON_SET, prop, value);
}

/**
 * Convenience function to generate a RegExp from a string.  Spaces in the original string
 * are re-interpreted to mean a sequence of zero or more whitespace characters.
 * @param  {String} str
 * @param  {String} flags
 * @return {RegExp}
 */
function regexp(str, flags) {
    return new RegExp(str.replace(/ /g, '[\\s\\n]*'), flags);
}

/**
 * Capture the contents of any/all underscore template blocks.
 * @type {RegExp}
 * @const
 */
var rgxLookup = /<%(=|-|)([\s\S]+?)%>/g;

/**
 * Find function declaractions (so that we can detect variables added to the closure scope
 * inside a template, as well as start and end of scope).
 * @type {RegExp}
 * @const
 */
var rgxScope = regexp(
    'function \\( ([\\w$_]* (, [\\w$_]+)*)  \\)|' +
    '(\\{)|' +
    '(\\})|' +
    '([\\s\\S])', 'g');

/**
 * Match function parameters found in the first line of rgxScope.
 * @type {RegExp}
 * @const
 */
var rgxArgs = /[\w$_]+/g;

/**
 * When used with string.replace, rgxUnquoted matches unquoted segments with the first group
 * and quoted segments with the second group.
 * @type {RegExp}
 * @const
 */
var rgxUnquoted = /([^'"]+)('[^']+'|"[^"]+")?/g;

/**
 * Find references that are not subproperty references of something else, e.g. ").hello"
 * @type {RegExp}
 * @const
 */
var rgxLookupableRef = regexp('(\\. )?(([\\w$_]+)(\\.[\\w$_]+)*)', 'g');

/**
 * Use to test whether a string is in fact a number literal.  We don't want to instrument those.
 * @type {RegExp}
 * @const
 */
var rgxNumber = /^\d+$/;

var neverLookup = {};
_.each(('break case catch continue debugger default delete do else finally for function if in ' +
        'instanceof new return switch this throw try typeof var void while with ' +
        'Array Boolean Date Function Iterator Number Object RegExp String ' +
        'isFinite isNaN parseFloat parseInt Infinity JSON Math NaN undefined true false null ' +
        '$ _ tbone T'
       ).split(' '), function (word) {
    neverLookup[word] = true;
});

tbone['dontPatch'] = function (namespace) {
    neverLookup[namespace] = true;
};

/**
 * Adds listeners for model value lookups to a template string
 * This allows us to automatically and dynamically bind to change events on the models
 * to auto-refresh this template.
 */
function withLookupListeners(str, textOp, closureVariables) {
    return str.replace(rgxLookupableRef, function (all, precedingDot, expr, firstArg) {
        if (neverLookup[firstArg] || precedingDot || rgxNumber.test(firstArg)) {
            return all;
        } else {
            if (closureVariables[firstArg] != null) {
                /**
                 * If the first part of the expression is a closure-bound variable
                 * e.g. from a _.each iterator, try to do a lookup on that (if it's
                 * a model).  Otherwise, just do a native reference.
                 */
                return [
                    '(',
                    firstArg,
                    ' && ',
                    firstArg,
                    '.isBindable ? ',
                    firstArg,
                    '.lookup',
                    textOp ? 'Text' : '',
                    '("',
                    expr.slice(firstArg.length + 1),
                    '")',
                    ' : ',
                    expr,
                    ')'
                ].join('');
            } else {
                /**
                 * Patch the reference to use lookup (or lookupText).
                 */
                return [
                    'root.lookup',
                    textOp ? 'Text' : '',
                    '(' + ITERATE_OVER_MODELS + ', "',
                    expr,
                    '")'
                ].join('');
            }
        }
    });
}

/**
 * Add a template to be used later via render.
 * @param {string} name   template name; should match tbone attribute references
 * @param {string} string template as HTML string
 */
function addTemplate(name, string) {
    templates[name] = string;
}

/**
 * Instrument the template for automatic reference binding via tbone.lookup/lookupText.
 * @param  {string} string Uninstrumented template as an HTML string
 * @return {function(Object): string}
 */
function initTemplate(string) {
    /**
     * As we parse through the template, we identify variables defined as function parameters
     * within the current closure scope; if a variable is defined, we instrument references to
     * that variable so that they use that variable as the lookup root, instead of using the
     * root context.  We push each new closure scope's variables onto varstack and pop them
     * off when we reach the end of the closure.
     * @type {Array.<Array.<string>>}
     */
    var varstack = [[]];
    /**
     * Hash set of variables that are currently in scope.
     * @type {Object.<string, boolean>}
     */
    var inClosure = {};

    function updateInClosure() {
        /**
         * Rebuild the hash set of variables that are "in closure scope"
         */
        inClosure = _['invert'](_.flatten(varstack));
    }
    updateInClosure();
    /**
     * First, find code blocks within the template.
     */
    var parsed = string.replace(rgxLookup, function (__, textOp, contents) {
        /**
         * List of accumulated instrumentable characters.
         * @type {Array.<string>}
         */
        var cs = [];

        /**
         * Inside the rgxScope replace function, we push unmatched characters one by one onto
         * cs.  Whenever we find any other input, we first flush cs by calling cs_parsed.
         * This calls withLookupListeners which does the magic of replacing native JS references
         * with calls to lookup or lookupText where appropriate.
         */
        function cs_parsed() {
            /**
             * Pass the accumulated string to withLookupListeners, replacing variable
             * references with calls to lookup.
             */
            var instrumented = withLookupListeners(cs.join(''), textOp, inClosure);
            cs = [];
            return instrumented;
        }

        /**
         * Find unquoted segments within the code block.  Pass quoted segments through unmodified.
         */
        var newContents = contents.replace(rgxUnquoted, function (__, unquoted, quoted) {
            /**
             * Process the unquoted segments, taking note of variables added in closure scope.
             * We should not lookup-patch variables that are defined in a closure (e.g. as the
             * looping variable of a _.each).
             */
            return unquoted.replace(rgxScope, function (all, args, __, openScope, closeScope, c) {
                if (c) {
                    /**
                     * Push a single character onto cs to be parsed in cs_parsed.  Obviously, not
                     * the most efficient mechanism possible.
                     */
                    cs.push(c);
                    return '';
                }
                if (openScope) {
                    /**
                     * We found a new function declaration; add a new closure scope to the stack.
                     */
                    varstack.push([]);
                } else if (args) {
                    /**
                     * We found an argument list for this function; add each of the arguments to
                     * the closure scope at the top of the stack (added above).
                     */
                    args.replace(rgxArgs, function (arg) {
                        varstack[varstack.length - 1].push(arg);
                    });
                } else if (closeScope) {
                    /**
                     * We found the closing brace for a closure scope.  Pop it off the stack to
                     * reflect that any variables attached to it are no longer in scope.
                     */
                    varstack.pop();
                }
                updateInClosure();
                /**
                 * Flush cs, and in addition to that, return the function/variables/brace that we
                 * just found.
                 */
                return cs_parsed() + all;
            }) + cs_parsed() + (quoted || '');
        }) + cs_parsed();
        return '<%' + textOp + newContents + '%>';
    });

    /**
     * Pass the template to _.template.  It will create a function that takes a single "root"
     * parameter.  On render, we'll pass either a model/collection or tbone itself as the root.
     * @type {Function}
     */
    var fn = _.template(parsed, null, { 'variable': 'root' });
    /**
     * For debugging purposes, save a copy of the parsed template for reference.
     * @type {string}
     */
    fn.parsed = parsed;
    return fn;
}

function renderTemplate(id, root) {
    var template = templates[id];
    if (!template) {
        error('Could not find template ' + id);
        return '';
    }
    if (typeof template === 'string') {
        template = templates[id] = initTemplate(template);
    }
    return template(root);
}

var baseView = Backbone.View.extend({
    isView: true,

    initialize: function (opts) {
        var self = this;
        uniqueId(self);
        _.extend(self, opts);
        self.priority = self.parentView ? self.parentView.priority - 1 : BASE_PRIORITY_VIEW;
        self.scope = autorun(self.render, self, self.priority, 'view_' + self.name,
                             self.onScopeExecute, self, true);
    },

    onScopeExecute: function (scope) {
        log(INFO, this, 'lookups', scope.lookups);
    },

    /**
     * View.destroy
     *
     * Destroys this view, removing all bindings and sub-views (recursively).
     */
    destroy: function (destroyRoot) {
        var self = this;
        log(VERBOSE, self, 'destroy', 'due to re-render of ' + destroyRoot.name);
        self.destroyed = true;
        self.scope.destroy();
        _.each(self.subViews || [], function (view) {
            view.destroy(self);
        });
        self['destroyDOM'](self.$el);
    },

    /**
     * View.render
     *
     * This function is called at View init, and again whenever any model properties that this View
     * depended on are changed.
     */
    render: function () {
        var self = this;
        // This view may get a reset call at the same instant that another
        // view gets created to replace it.
        if (!self.destroyed) {
            /**
             * Move all this view's children to another temporary DOM element.  This will be used as the
             * pseudo-parent element for the destroyDOM call.
             */
            if (self.templateId) {
                /**
                 * If the DOM fragment to be removed has an active (focused) element, we attempt
                 * to restore that focus after refreshing this DOM fragment.  We also attempt
                 * to restore the selection start/end, which only works in Webkit/Gecko right
                 * now; see the URL below for possible IE compatibility.
                 */
                var activeElement = document.activeElement;
                var activeElementSelector, activeElementIndex, selectionStart, selectionEnd;
                if (_.contains($(activeElement).parents(), self.el)) {
                    // XXX this could be improved to pick up on IDs/classes/attributes or something?
                    activeElementSelector = 'input';
                    activeElementIndex = _.indexOf(self.$(activeElementSelector), activeElement);
                    // XXX for IE compatibility, this might work:
                    // http://the-stickman.com/web-development/javascript/ ...
                    // finding-selection-cursor-position-in-a-textarea-in-internet-explorer/
                    selectionStart = activeElement.selectionStart;
                    selectionEnd = activeElement.selectionEnd;
                }

                var $old = $('<div>').append(this.$el.children());
                var newHtml = renderTemplate(self.templateId, self.root());
                log(INFO, self, 'newhtml', newHtml);
                self.$el.html(newHtml);

                /**
                 * Execute the "fragment ready" callback.
                 */
                self['ready']();
                self['postReady']();

                /**
                 * (Re-)create sub-views for each descendent element with a tbone attribute.
                 * On re-renders, the pre-existing list of sub-views is passed to render, which
                 * attempts to pair already-rendered views with matching elements in this view's
                 * newly re-rendered template.  Matching views are transferred to the new DOM
                 * hierarchy without disruption.
                 */
                var oldSubViews = self.subViews || [];
                self.subViews = render(self.$('[tbone]'), self, oldSubViews);
                var obsoleteSubViews = _.difference(oldSubViews, self.subViews);
                /**
                 * Destroy all of the sub-views that were not reused.
                 */
                _.each(obsoleteSubViews, function (view) {
                    view.destroy(self);
                });
                /**
                 * Call destroyDOM with the the pseudo-parent created above.  This DOM fragment contains all
                 * of the previously-rendered (if any) DOM structure of this view and subviews, minus any
                 * subviews that are being reused (which have already been moved to the new parent).
                 */
                self['destroyDOM']($old);

                /**
                 * If we saved it above, restore the active element focus and selection.
                 */
                if (activeElementSelector) {
                    var newActiveElement = self.$(activeElementSelector)[activeElementIndex];
                    $(newActiveElement).focus();
                    if (selectionStart != null && selectionEnd != null) {
                        newActiveElement.selectionStart = selectionStart;
                        newActiveElement.selectionEnd = selectionEnd;
                    }
                }
            } else {
                self['ready']();
                self['postReady']();
            }
            self['postRender']();
            viewRenders++;
        }
    },

    /**
     * View.ready
     *
     * The "template-ready" callback.  This is the restricted tbone equivalent of document-ready.
     * It is the recommended means of adding interactivity/data/whatever to Views.
     *
     * At the moment this callback is executed, subviews are neither rendered nor are they
     * attached to the DOM fragment.  If you need to interact with subviews, use postRender.
     */
    'ready': noop,

    /**
     * View.postReady
     *
     * This is the same as ready, except that it executes after ready.  The typical use case is
     * to override this in your base template to provide automatic application-wide helpers,
     * such as activating a tooltip library, and to use View.ready for specific view logic.
     */
    'postReady': noop,

    /**
     * View.postRender
     *
     * The "fragment-updated" callback.  This is executed whenever this view is re-rendered,
     * and after all sub-views (recursively) have rendered.
     *
     * Note that because we optimistically re-use sub-views, this may be called multiple times
     * with the same sub-view DOM fragments.  Ensure that anything you do to DOM elements in
     * sub-views is idempotent.
     */
    'postRender': noop,

    /**
     * View.destroyDOM
     *
     * The "document-destroy" callback.  Use this to do cleanup on removal of old HTML, e.g.
     * destroying associated tooltips.
     *
     * Note: Destroy contents of the $el parameter, not this.$el!  (XXX make this less error-prone)
     *
     * @param  {!jQuery} $el jQuery selection of DOM fragment to destroy
     */
    'destroyDOM': function ($el) { },

    /**
     * If a root attribute was specified, use that as the root object for this view's
     * render, both in templating automatically as well as available via this.root in
     * `ready` and `postRender` callbacks.
     */
    root: function () {
        var self = this;
        if (self.rootMemoized == null) {
            self.rootMemoized = self.rootStr && lookup(DONT_GET_DATA, self.rootStr) || tbone;
        }
        return self.rootMemoized;
    },

    /**
     * Perform a safe lookup on the view's root, if any.  If there's no root, returns null.
     **/
    // This should be rewritten to memoize the rootStr part of view lookups.
    // This will need to work around the existing warning feature in the lookup
    // function for cases where the root is actually a property of a model.
    // Sublookups from there don't reference a model, and while this is all right
    // (because the lookup of rootStr has bound the view already to that model),
    // there could be some subtleties about how that connection is made and passed
    // around... and this would be a great thing to implement alongside passing
    // *data* to subviews through template references, e.g. ${id(data)}.
    'query': function (query) {
        query = (this.rootStr ? this.rootStr + '.' : '') + query;
        return lookup(query);
    },

    // deprecated
    'lookup': function (query) {
        return this['query'](query);
    },

    'parentRoot': function () {
        return this.parentView && this.parentView.root();
    },

    'parent': function () {
        return this.parentView;
    }
});

/**
 * Use to find key/value pairs in tbone attributes on render.
 * @type {RegExp}
 * @const
 */
var rgxTBoneAttribute = /[^\w.]*([\w.]+)[^\w.]+([\w.]+)/g;

/**
 * tbone.render
 *
 * Render an array of HTML elements into Views.  This reads the tbone attribute generates a View
 * for each element accordingly.
 *
 * @param  {Array.<DOMElement>}     $els     elements to render templates from
 * @param  {Backbone.View=}         parent   parent view
 * @param  {Array.<Backbone.View>=} subViews (internal) sub-views created previously; these are used
 *                                           to avoid redundantly regenerating unchanged views.
 * @return {Array.<Backbone.View>}           views created (and/or substituted from subViews)
 */
function render($els, parent, subViews) {
    var subViewMap = {};
    _.each(subViews || [], function (subView) {
        (subViewMap[subView.origOuterHTML] = subViewMap[subView.origOuterHTML] || []).push(subView);
    });
    return _.map($els, function (el) {
        var $this = $(el);
        var outerHTML = el.outerHTML;
        if (subViewMap[outerHTML] && subViewMap[outerHTML].length) {
            /**
             * If we have a pre-rendered view available with matching outerHTML (i.e. nothing in
             * the parent template has changed for this subview's root element), then just swap
             * the pre-existing element in place along with its undisturbed associated View.
             */
            var subView = subViewMap[outerHTML].shift();
            log(VERBOSE, parent || 'render', 'reuse', subView);
            $this.replaceWith(subView.el);
            return subView;
        } else {
            /**
             * Otherwise, read the tbone attribute from the element and use it to instantiate
             * a new View.
             */
            var props = {};
            ($this.attr('tbone') || '').replace(rgxTBoneAttribute, function(__, prop, value) {
                props[prop] = value;
            });
            var inlineTemplateId = props['inline'];
            if (inlineTemplateId) {
                /**
                 * XXX what's the best way to get the original html back?
                 */
                var origTemplateHtml = $this.html()
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&');
                addTemplate(inlineTemplateId, origTemplateHtml);
            }
            var templateId = inlineTemplateId || props['tmpl'];
            var viewId = props['view'];
            var rootStr = props['root'];

            /**
             * Use either the view or template attributes as the `name` of the view.
             */
            var name = viewId || templateId;
            if (!name) {
                error('No view or template was specified for this element: ', el);
            }
            if (templateId && !templates[templateId]) {
                error('Could not find template for ' + templateId + '.  If you don\'t want to ' +
                      'use a template, use the view attribute instead.');
            }
            /**
             * Add a class matching the view name for styling convenience.
             */
            $this.addClass(name);

            /**
             * Find the corresponding view matching the name (`viewId` or `templateId`) to the
             * name passed to `createView.`  If there is no view matching that name, then use
             * the default view.  You can set the default view using `tbone.defaultView().`
             * @type {function(new:Backbone.View, Object)}
             */
            var MyView = views[name] || defaultView;

            return new MyView({
                name: name,
                origOuterHTML: outerHTML,
                'el': el,
                templateId: templateId,
                parentView: parent,
                rootStr: rootStr
            });
        }
    });
}

var defaultView = baseView;
function __defaultView(view) {
    if (view) {
        defaultView = view;
    }
    return defaultView;
}

/**
 * tbone.createView
 *
 * Create a new view, inheriting from another view (or the default view).
 *
 * This is the primary method you should use to add JS logic to your application. e.g.:
 *
 * tbone.createView('widget', function () {
 *     this.$('span').text('42');
 *     this.$('a[href]').click(function () {
 *         tbone.set('selected.widget', $(this).attr('id'));
 *         return false;
 *     })
 * });
 *
 * The function above whenever a template renders an element with a tbone attribute
 * of "widget", and this.$ will be scoped to that view.
 *
 * @param  {String=}                       name Name for the view.
 * @param  {new(Backbone.View, Object=)=}  base Base view to extend.
 * @param  {Function}                      fn   convenience parameter for specifying ready
 *                                              function.
 * @param  {Object}                        opts additional prototype properties
 * @return {new(Backbone.View, Object=)}
 */
function createView(name, base, fn, opts) {
    var args = [].slice.call(arguments);
    var arg = args.shift();
    if (typeof arg === 'string') {
        name = arg;
        arg = args.shift();
    } else {
        name = 'v' + nextId++;
    }
    if (arg && arg.extend) {
        base = arg;
        arg = args.shift();
    } else {
        base = defaultView;
    }
    if (typeof arg === 'function') {
        fn = arg;
        arg = args.shift();
    } else {
        fn = null;
    }
    opts = arg || {};
    opts.name = name;
    var baseReady = base.prototype['ready'];
    if (fn) {
        opts['ready'] = baseReady === noop ? fn : function () {
            baseReady.call(this);
            fn.call(this);
        };
    }
    return views[name] = base.extend(opts);
}

_.each([Backbone.Model.prototype, Backbone.Collection.prototype], function (proto) {
    _.extend(proto, {
        /**
         * isBindable is just a convenience used to identify whether an object is
         * either a Model or a Collection.
         */
        'isBindable': true,

        /**
         * Copy query and text onto the Model, View, and Collection.
         *
         */
        'query': lookup,
        'text': lookupText,

        // deprecated
        'lookup': lookup,
        // deprecated
        'lookupText': lookupText,

        /**
         * Wake up this model as well as (recursively) any models that depend on
         * it.  Any view that is directly or indirectly depended on by the current
         * model may now be able to be awoken based on the newly-bound listener to
         * this model.
         * @param  {Object.<string, Boolean>} woken Hash map of model IDs already awoken
         */
        wake: function (woken) {
            // Wake up this model if it was sleeping
            if (this.sleeping) {
                this.trigger('wake');
                this.sleeping = false;
                this.reset();
            }
            /**
             * Wake up models that depend directly on this model that have not already
             * been woken up.
             */
            _.each((this.scope && this.scope.lookups) || [], function (lookup) {
                var bindable = lookup.__obj__;
                if (bindable && !woken[uniqueId(bindable)]) {
                    woken[uniqueId(bindable)] = true;
                    bindable.wake(woken);
                }
            });
        }
    });

    /**
     * We wrap proto.on in order to wake up and reset models
     * that were previously sleeping because they did not need to be updated.
     * This passes through execution to the original on function.
     */
    var originalOn = proto.on;
    proto['on'] = function () {
        this.wake({});
        return originalOn.apply(this, arguments);
    };
});

_.each([baseModel, baseCollection], function (obj) {
    _.extend(obj.prototype, {
        /**
         * Disable backbone-based validation; by using validation to prevent populating
         * form input data to models, backbone validation is at odds with the TBone
         * concept that all data in the UI should be backed by model data.
         *
         * By overriding _validate, we can still use isValid and validate, but Backbone
         * will no longer prevent set() calls from succeeding with invalid data.
         */
        '_validate': function () { return true; }
    });
});

var data = new Backbone.Model();

var orig_tbone = window['tbone'];
var orig_T = window['T'];

window['tbone'] = window['T'] = tbone;
tbone['models'] = models;
tbone['views'] = views;
tbone['collections'] = collections;
tbone['data'] = data;
tbone['_data'] = data.attributes; // XXX don't use this
tbone['templates'] = templates;

tbone['autorun'] = tbone['set'] = tbone['lookup'] = tbone;
tbone['lookupText'] = lookupText;
tbone['toggle'] = toggle;
tbone['extend'] = extend;

tbone['createModel'] = createModel;
tbone['createCollection'] = createCollection;
tbone['createView'] = createView;
tbone['defaultView'] = __defaultView;
tbone['addTemplate'] = addTemplate;
tbone['render'] = render;

tbone['noConflict'] = function () {
    window['T'] = orig_T;
    window['tbone'] = orig_tbone;
};

models['base'] = baseModel;

if (TBONE_DEBUG) {
    tbone['getListeners'] = getListeners;
    tbone['hasViewListener'] = hasViewListener;
}

}());
