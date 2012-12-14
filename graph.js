
function createGraph(opts) {
    function getClassDict(el) {
        var classes = {};
        _.each(($(el).attr('class') || '').split(/\s+/g), function(v) {
            classes[v] = true;
        });
        return classes;
    }

    function setClassAttr(el, dict) {
        $(el).attr('class', _.keys(dict).join(' '));
    }

    function addClass(el, classname) {
        var a = getClassDict(el);
        a[classname] = true;
        setClassAttr(el, a);
    }

    function removeClass(el, classname) {
        var a = getClassDict(el);
        delete a[classname];
        setClassAttr(el, a);
    }

    opts = _.extend({
        height: 1000
    }, opts);

    var RADIUS = 12;

    var links = {};
    var linksByNode = {};
    var linksCount = {};
    var linksRevCount = {};
    var linksList = [];
    var nodes = {};
    var nodesList = [];
    var circlesList = [];
    var squaresList = [];

    var layout = dagre.layout()
        .nodeSep(10)
        .edgeSep(5)
        .rankSep(20)
        .nodes(nodesList)
        .edges(linksList);

    var svg = d3.select(opts.el).append("svg:svg")
        .attr("width", '100%')
        .attr("height", '100%')
        .classed('tbonevis', true);

    // Per-type markers, as they don't inherit styles.
    svg.append("svg:defs").selectAll("marker")
        .data(['data'])
      .enter().append("svg:marker")
        .attr("id", String)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", RADIUS - 5)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
      .append("svg:path")
        .attr("d", "M0,-5L10,0L0,5");

    function selectGen(type) {
        var root = svg.append("g");
        return function() {
            return root.selectAll(type + ':not(.remove)');
        };
    }
    var selectLinks = selectGen('path');
    var selectModels = selectGen('path');
    var selectText = selectGen('text');
    // var m = selectGen('path');
    // var sqroot = d3.select('body').append("div").classed('tbonevis-views', true);
    function sum(arr) {
        return _.reduce(arr, function(memo, num) {
            return memo + num;
        }, 0);
    }

    function mean(arr) {
        return sum(arr) / arr.length;
    }

    function sigma(arr) {
        return sum(_.map(arr, function(x) { return x * x; })) / (arr.length * arr.length);
    }

    function countTargetsRecursive(name, alreadyCounted) {
        if (!alreadyCounted) { alreadyCounted = {}; }
        alreadyCounted[name] = true;
        var counts = _.map(_.keys(links[name] || {}), function(targetName) {
            return alreadyCounted[targetName] ? 0 : countTargetsRecursive(targetName, alreadyCounted);
        });
        return 1 + sum(counts);
    }

    var widthadjcenter = 0;
    function x(d) {
        return (d.dagre.x || 0) + widthadjcenter;
    }

    function y(d) {
        return d.dagre.y || 0;
    }

    function loc(d) {
        return "translate(" + Math.round(x(d)) + "," + Math.round(y(d)) + ")";
    }

    function linkloc(d) {
        var dx = x(d.target) - x(d.source),
            dy = y(d.target) - y(d.source),
            dr = Math.sqrt(dx * dx + dy * dy);
        if (dr) {
            var vec = { x: RADIUS * dx / dr, y: RADIUS * dy / dr };
            var arc = false;
            var middle = arc ? "A" + dr + "," + dr + " 0 0,1 " : "L";
            return ("M" + (x(d.source) + vec.x) + "," + (y(d.source) + vec.y) + middle +
                (x(d.target) - vec.x) + "," + (y(d.target) - vec.y));
        } else {
            return "M0,0";
        }
    }

    function refreshLocsNow () {
        selectLinks().transition().duration(500).attr("d", linkloc);
        selectModels().transition().duration(500).attr("transform", loc);
        selectText().transition().duration(500).attr("transform", loc);
        // var $vis = $('div.tbonevis');
        // var visoffset = $vis.offset();
        // var bodyoffset = $('html').offset();
        // square().each(function(d) {
        //     function getcss($el) {
        //         var offset = $el.offset();
        //         return {
        //             top: offset ? offset.top - bodyoffset.top : 0,
        //             left: offset ? offset.left - bodyoffset.left : 0,
        //             width: $el.outerWidth(),
        //             height: $el.outerHeight(),
        //             display: (offset && (offset.top || offset.left)) ? 'block' : 'none'
        //         };
        //     }
        //     var $el = d.obj.$el;
        //     if ($el && $el.length) {
        //         var css = getcss($el);
        //         if (!css.height) {
        //             var $child = $el.children().eq(0);
        //             var altcss = getcss($child);
        //             if (altcss.height) {
        //                 css = altcss;
        //             }
        //         }
        //         $(this).css(css);
        //         d.X = -100; //css.left + css.width * 0.5 - visoffset.left;
        //         // if (d.X < -100) { d.X = -100; }
        //         d.Y = css.top + css.height * 0.5 - visoffset.top;
        //     }
        // });

    }
    var refreshLocs = _.debounce(refreshLocsNow, 10);

    function getNodeElements(node) {
        return node ? [ node.el, node.textel ] : [];
    }

    function getListenerViews(node) {
        return _.chain(tbone.getListeners(node.obj)).filter(function(obj) {
            return obj.context && obj.context.isView;
        }).map(function(obj) { return obj.context; }).value();
    }

    function getListenerViewElements(node) {
        return _.chain(getListenerViews(node)).map(function(view) {
            var d = nodes[view.tboneid];
            return d && d.visible ? getNodeElements(d) : [];
        }).flatten().value();
    }

    var hoverDownstream = [];
    var hoverUpstream = [];
    var pingDownstream = [];
    var hovered = [];

    function mousein(node) {
        var linksDownstream = _.filter(activeLinks, function (link) { return link.source === node; });
        var nodesDownstream = _.uniq(_.map(linksDownstream, function (link) { return link.target; }));
        hoverDownstream = _.pluck(linksDownstream, 'el').concat(_.flatten(_.map(nodesDownstream, getNodeElements)));
        var linksUpstream = _.filter(activeLinks, function (link) { return link.target === node; });
        var nodesUpstream = _.uniq(_.map(linksUpstream, function (link) { return link.source; }));
        hoverUpstream = _.pluck(linksUpstream, 'el').concat(_.flatten(_.map(nodesUpstream, getNodeElements)));
        // pingDownstream = getListenerViewElements(node);
        // _.each(pingDownstream, function(el) {
        //     removeClass(el, 'unping');
        //     addClass(el, 'ping');
        // });
        _.each(hoverDownstream, function(el) {
            removeClass(el, 'unping');
            addClass(el, 'hover-downstream');
        });
        _.each(hoverUpstream, function(el) {
            removeClass(el, 'unping');
            addClass(el, 'hover-upstream');
        });
        hovered = getNodeElements(node);
        _.each(hovered, function(el) {
            removeClass(el, 'unping');
            addClass(el, 'hover');
        });
    }

    function mouseout(node) {
        _.each(pingDownstream, function(el) {
            removeClass(el, 'ping');
        });
        _.each(hoverDownstream, function(el) {
            removeClass(el, 'hover-downstream');
        });
        hoverDownstream = [];
        _.each(hoverUpstream, function(el) {
            removeClass(el, 'hover-upstream');
        });
        hoverUpstream = [];
        _.each(hovered, function(el) {
            removeClass(el, 'hover');
        });
        hovered = [];
    }

    var objects = [];
    var models = [];
    var activeModels = [];
    var activeViews = [];
    var activeLinks = [];

    var restart = _.debounce(function() {
        _.each(activeModels, function(d) {
            d.viewListeners = _.reduce(d.listeners, function(list, listenerid) {
                var listener = objects[listenerid];
                return list.concat(listener.isView ? [ listener ] : []);
            }, []);
            d.text = d.name + (d.viewListeners.length ? ' (' + d.viewListeners.length + ')' : '');
            d.textwidth = Math.max(0, textWidth(d.text) - RADIUS); // - RADIUS just gives a little room for rounded corners
            d.width = d.textwidth + 4 + RADIUS * 2;
            d.height = 4 + RADIUS * 2;
        });

        layout.nodes(activeModels).edges(activeLinks);
        layout.run();

        widthadjcenter = 0.5 * ($('body').outerWidth() - _.reduce(activeModels, function(memo, node) {
            return Math.max(memo, node.dagre.x + node.width);
        }, 0));

        var linksDelta = selectLinks().data(activeLinks, function(d) { return d.source.id + '-' + d.target.id; });
        linksDelta.exit().classed("remove", true).transition().delay(1000).remove();
        linksDelta.enter().append("path")
            .attr("d", linkloc)
            .classed("link", true)
            .each(function(d) { d.el = this; });

        var modelDelta = selectModels().data(activeModels, function(d) { return d.id; });
        modelDelta.exit()
            .each(function(d) {
                $(this).tooltip('destroy');
            })
            .classed("remove", true)
            .transition()
            .delay(1000)
            .remove();
        modelDelta.enter().append("path")
            .attr("transform", loc)
            .attr("d", function(d) {
                // Draw a rounded rectangle.
                return (
                    "M -W -R" +
                    "A R R 0 0 0 -W R" +
                    "L W R" +
                    "A R R 0 0 0 W -R" +
                    "L -W -R"
                    ).replace(/R/g, RADIUS).replace(/W/g, Math.round(d.textwidth / 2));
            })
            .attr('class', function(d) {
                return 'unping node node-' + d.id + (d.waiting ? ' waiting' : '');
            })
            .on('mouseover', mousein)
            .on('mouseout', mouseout)
            .each(function(d) { d.el = this; })
            .html(function(d) {
                var $this = $(this);
                $this.tooltip({
                    placement: 'right',
                    delay: 0,
                    positionCallback: function() {
                        return {
                            top: $this.offset().top,
                            left: $this.offset().left - $('html').offset().left,
                            height: 2 * RADIUS,
                            width: 2 * RADIUS + d.textwidth
                        };
                    },
                    title: function() {
                        var viewsList = _.map(d.viewListeners, function(view) { return view.name; });
                        var viewsText = _.map(_.groupBy(viewsList, function (i) { return i; }), function(list, view) {
                            return view + (list.length > 1 ? ' x ' + list.length : '');
                        }).join(' <br>');
                        return '<center> ' + d.name + ' ' +
                            (viewsText ? (' <hr> <views> ' + viewsText + ' </views>') : '') +
                            ' </center>';
                    }
                });
            });

        // square().remove();
        // square().data(squaresList).enter().append('div')
        //     .attr('class', function(d) { return 'unping tbonevis-view view node node-' + d.name; })
        //     .each(function(d) { d.el = this; });

        var textDelta = selectText().data(activeModels, function(d) { return d.id; });
        textDelta.exit().classed("remove", true).transition().delay(1000).remove();
        textDelta.enter().append("text")
            .attr("transform", loc)
            .attr('text-anchor', 'middle')
            .attr("y", ".28em")
            .text(function(d) { return d.text; })
            .each(function(d) { d.textel = this; });


        // svg.attr('height', function() {
        //     return _.reduce(nodesList, function(memo, node) {
        //         return Math.max(memo, node.dagre.y + node.height);
        //     }, 0);
        // });

        refreshLocsNow();
    }, 200);

    var textWidths = {};
    function textWidth(text) {
        if (!textWidths[text]) {
            var $el = $('<span>').text(text).addClass('tbonevis-width-test').appendTo('body');
            textWidths[text] = $el.width();
            $el.remove();
        }
        return textWidths[text];
    }

    function getNode(_node) {
        var name = _node.name;
        var node = nodes[name];
        if (!node) {
            nodes[name] = node = _.clone(_node);
            nodesList.push(node);
            linksByNode[name] = [];
            (node.type.match(/model/) ? circlesList : squaresList).push(node);
        }
        return node;
    }

    $(window).resize(function() {
        restart();
    });

    return {
        reset: function(objs) {
            objects = objs;
            models = _.filter(objs, function(obj) { return !obj.isView; });
            activeModels = _.filter(models, function(obj) { return obj.isActive; });
            activeLinks = _.flatten(_.map(activeModels, function(model) {
                return _.map(model.listeners, function(listenerid) {
                    var listener = objs[listenerid];
                    return listener.isActive && !listener.isView ? [{ source: model, target: listener }] : [];
                });
            }));
            activeViews = _.filter(objs, function(obj) { return obj.isActive && obj.isView; });
            restart();
        },
        // addLink: function(opts) {
        //     opts = _.extend({
        //         type: 'link'
        //     }, opts);
        //     opts.source = getNode(opts.source);
        //     opts.target = getNode(opts.target);
        //     var link = _.clone(opts);
        //     if (!links[link.source.name]) {
        //         links[link.source.name] = {};
        //         linksCount[link.source.name] = 0;
        //     }
        //     if (!links[link.source.name][link.target.name]) {
        //         links[link.source.name][link.target.name] = true;
        //         linksCount[link.source.name] = (linksCount[link.source.name] || 0) + 1;
        //         linksRevCount[link.target.name] = (linksRevCount[link.target.name] || 0) + 1;
        //         linksList.push(link);
        //         linksByNode[link.source.name].push(link);
        //         linksByNode[link.target.name].push(link);
        //         restart();
        //     }
        // },
        // waiting: function(opts) {
        //     /**
        //      * We're fetching id, e.g. an ajax call is in progress
        //      */
        //     getNode(opts).waiting = true;
        //     var $el = $('.node-' + opts.id);
        //     removeClass($el[0], 'unping');
        //     addClass($el[0], 'waiting');
        // },
        ping: function(id) {
            // getNode(opts).waiting = false;
            // refreshLocs();
            var $el = $('.node-' + id);
            removeClass($el[0], 'waiting');
            removeClass($el[0], 'unping');
            addClass($el[0], 'ping');
            setTimeout(function() {
                setTimeout(function() {
                    addClass($el[0], 'unping');
                    removeClass($el[0], 'ping');
                }, 400);
            }, 1);
        }
    };
}
