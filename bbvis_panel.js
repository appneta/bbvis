var objs = {};

tbone.createModel('options').singleton();
T('options.showViews', true);
T('options.showDetails', true);

T(function() {
    $('#numViews').text(tbone.lookupText('info.numViews'));
    $('#numModels').text(tbone.lookupText('info.numModels'));
    $('#numLinks').text(tbone.lookupText('info.numLinks'));
});

$.fn.reclick = function (cb) {
    return this.unbind('click').bind('click', cb);
};

tbone.createView('toggles', function () {
    this.$('#toggle_details')
        .text((T('options.showDetails') ? 'hide' : 'show') + ' details')
        .reclick(function () {
            T.toggle('options.showDetails');
            _.defer(update);
            return false;
        });

    this.$('#toggle_inactive')
        .text('show ' + (T('options.showAllModels') ? 'only active' : 'all') + ' models')
        .reclick(function () {
            T.toggle('options.showAllModels');
            _.defer(updateImmediate);
            return false;
        });

    this.$('#toggle_views')
        .text(T('options.showViews') ? 'hide views' : 'show views')
        .reclick(function () {
            T.toggle('options.showViews');
            _.defer(updateImmediate);
            return false;
        });
});

T(function () {
    $('body').toggleClass('details-hidden', !T('options.showDetails'));
});

function hasViewListener(obj, visited) {
    if (!visited) { visited = {}; }
    if (!visited[obj.id]) {
        visited[obj.id] = true;
        return obj.isActive = !!(
            // If we have already calculated isActive this round, return that
            obj.isActive !== null ?
                obj.isActive :
                // If it's a view, return isActiveView (this is determined in instrumentation)
                obj.isView ?
                    obj.isActiveView :
                    // Otherwise, recursively call hasViewListener for models
                    _.any(obj.listeners || [], function(id) {
                        return objs[id] && hasViewListener(objs[id], visited);
                    }));
    } else {
        // We've already visited this, which means that this is a model and that we're
        // already checking or have checked its listeners recursively.
        return false;
    }
}

var graph = createGraph({
    el: $('#graph')[0],
    onHover: function (id) {
        hover(id);
    }
});

function updateImmediate() {
    // Compute isActive for everyone
    _.each(objs, function (obj) {
        obj.isActive = null;
    });
    _.each(objs, function (obj) {
        hasViewListener(obj);
    });

    var showViews = !!T('options.showViews');
    var showAllModels = !!T('options.showAllModels');
    function showNode(node) {
        return node.isView ? (node.isActive && showViews) :
            (node.isActive || showAllModels);
    }
    _.each(objs, function (obj) {
        obj.isVisible = showNode(obj);
    });
    T('data.objects', _.clone(objs));
}

tbone.createModel('info', function () {
    return _.reduce(active, function(memo, obj) {
        if (obj.isActive) {
            if (obj.isView) {
                memo.numViews++;
            } else {
                memo.numModels++;
            }
            memo.numLinks += _.reduce(obj.listeners, function(num, listenerid) {
                var listener = objs[listenerid];
                return listener ? num + (listener.isActive ? 1 : 0) : 0;
            }, 0);
            return memo;
        }
    }, { numViews: 0, numModels: 0, numLinks: 0 });
}).singleton();

var update = _.debounce(updateImmediate, 100);

tbone.createView('graph', function () {
    graph.reset(T('data.objects'));
});

tbone.render($('[tbone]'));

function receive(event) {
    // respond({ msg: 'received ' + event.msg });
    if (event.reload) {
        console.log('BBVis: Reloading.');
        objs = {};
        update();
        restart();
    } else if (!objs[event.id] || event.listeners) {
        objs[event.id] = _.extend(objs[event.id] || {}, event);
        update();
        graph.updateText();
    } else if (event.ping) {
        graph.ping(event.id);
    }
}
