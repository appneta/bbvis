var objs = {};

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
            return false;
        });

    this.$('#toggle_inactive')
        .text('show ' + (T('options.showAllModels') ? 'only active' : 'all') + ' models')
        .reclick(function () {
            T.toggle('options.showAllModels');
            return false;
        });

    this.$('#toggle_views')
        .text(T('options.showViews') ? 'hide views' : 'show views')
        .reclick(function () {
            T.toggle('options.showViews');
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

function updateImmediate() {
    // Compute isActive for everyone
    _.each(objs, function (obj) {
        obj.isActive = null;
    });
    _.each(objs, function (obj) {
        hasViewListener(obj);
    });
    T('data.objects', _.clone(objs));
}

T('info', function () {
    return _.reduce(T('data.objects'), function(memo, obj) {
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
        }
        return memo;
    }, { numViews: 0, numModels: 0, numLinks: 0 });
});

var RADIUS = 10;

var textWidths = {};
function textWidth(text) {
    if (!textWidths[text]) {
        var $el = $('<span>').text(text).addClass('tbonevis-width-test').appendTo('body');
        textWidths[text] = $el.width();
        $el.remove();
    }
    return textWidths[text];
}

T('visible', function () {
    var showViews = !!T('options.showViews');
    var showAllModels = !!T('options.showAllModels');
    var objs = _.map(T('data.objects'), function (node) {
        return _.extend({
            isVisible: node.isView ? (node.isActive && showViews) :
                (node.isActive || showAllModels)
        }, node);
    });
    var visibleNodes = _.chain(objs)
        .filter(function (node) { return node.isVisible; })
        .map(function (node) {
            var viewListeners = _.reduce(node.listeners, function(list, listenerid) {
                var listener = objs[listenerid];
                return list.concat(listener && listener.isView ? [ listener ] : []);
            }, []);
            var text = ' ' + node.name
                // + (viewListeners.length ? ' (' + viewListeners.length + ')' : '')
                + ' ';
            var textwidth = Math.max(0, textWidth(text) - RADIUS);
            return _.extend({}, node, {
                viewListeners: viewListeners,
                text: text,
                textwidth: textwidth, // - RADIUS just gives a little room for rounded corners
                width: textwidth + 4 + RADIUS * 2,
                height: 4 + RADIUS * 2
            });
        })
        .value();
    var map = {};
    _.each(visibleNodes, function (node) {
        map[node.id] = node;
    });
    var visibleLinks = _.flatten(_.map(visibleNodes, function(node) {
        return _.map(node.listeners || [], function(listenerid) {
            var listener = map[listenerid];
            return listener && listener.isVisible ?
                [{ source: node, target: listener }] : [];
        });
    }));

    return {
        nodes: visibleNodes,
        links: visibleLinks,
        nodesById: map
    };
});

T('selectedNodeText', function () {
    var id = T('selectedId');
    if (id != null) {
        var data = T('visible.nodesById.' + id + '.data');
        var json = data == null ? null : JSON.parse(data);
        var noDataMsg = 'no data for this object (bbvis error?)';
        return json === null ? noDataMsg : JSON.stringify(json, null, 2);
    } else {
        return "select a model to see its data"
    }
});

var update = _.debounce(updateImmediate, 100);

tbone.render($('[tbone]'));

function updateScreenDimensions () {
    T('screen.width', $(window).width());
    T('screen.height', $(window).height());
}
$(window).bind('resize', updateScreenDimensions);
function timer () {
    updateScreenDimensions();
    setTimeout(timer, 1000);
}

var graph = createGraph({
    el: $('#graph')[0],
    onHover: function (id) {
        hover(id);
    }
});

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
    } else if (event.ping) {
        graph.ping(event.id);
    }
}
