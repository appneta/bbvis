var objs = {};

// tbone.addTemplate('content', '<p>Num Views: <%=data.numViews%></p><p>Num Models: <%=data.numModels%></p>');
// tbone.render($('[tmpl]'));
tbone.createModel('dat').singleton();

tbone.autorun(function() {
    $('#numViews').text(tbone.lookupText('dat.numViews'));
    $('#numModels').text(tbone.lookupText('dat.numModels'));
    $('#numLinks').text(tbone.lookupText('dat.numLinks'));
});

function hasViewListener(obj, visited) {
    if (!visited) { visited = {}; }
    if (!visited[obj.id]) {
        visited[obj.id] = true;
        return obj.isActive = !!(
            // If we have already calculated isActive this round, return that
            obj.isActive !== null ?
                obj.isActive :
                // If it's a view, return isActiveView (this is determined in inject.js)
                obj.isView ?
                    obj.isActiveView :
                    // Otherwise, recursively call hasViewListener for models
                    _.any(obj.listeners || [], function(id) {
                        return hasViewListener(objs[id], visited);
                    }));
    } else {
        // We've already visited this, which means that this is a model and that we're
        // already checking or have checked its listeners recursively.
        return false;
    }
}

var graph = createGraph({ el: $('#graph')[0] });

var update = _.debounce(function() {
    // Compute isActive for everyone
    _.each(objs, function (obj) {
        obj.isActive = null;
    });
    _.each(objs, function (obj) {
        hasViewListener(obj);
    });

    var active = _.filter(_.values(objs), function(obj) { return obj.isActive; });

    var data = _.reduce(active, function(memo, obj) {
        if (obj.isView) {
            memo.numViews++;
        } else {
            memo.numModels++;
        }
        memo.numLinks += _.reduce(obj.listeners, function(num, listenerid) {
            var listener = objs[listenerid];
            return num + (listener.isActive ? 1 : 0);
        }, 0);
        return memo;
    }, { numViews: 0, numModels: 0, numLinks: 0 });
    tbone.set('dat.numViews', data.numViews);
    tbone.set('dat.numModels', data.numModels);
    tbone.set('dat.numLinks', data.numLinks);
    // console.log('dat', data);
    graph.reset(objs);
}, 100);

function receive(event) {
    // respond({ msg: 'received ' + event.msg });
    // document.body.textContent = JSON.stringify(event);
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
