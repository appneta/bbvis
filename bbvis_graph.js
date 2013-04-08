
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
        height: 1000,
        onHover: function () {}
    }, opts);

    var links = {};
    var linksByNode = {};
    var linksCount = {};
    var linksRevCount = {};
    var nodes = {};

    var layout = dagre.layout()
        .nodeSep(8)
        .edgeSep(4)
        .rankSep(10);

    var svg = d3.select(opts.el).append("svg:svg")
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

    var PADDING_TOP = 6;
    function y(d) {
        return d.dagre.y || 0 + PADDING_TOP;
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
    }
    var refreshLocs = _.debounce(refreshLocsNow, 10);

    T(function () {
        var visibleLinks = T('visible.links') || [];
        var id = T('hoveredId');
        selectLinks()
            .classed('hover-downstream', function (link) {
                return link.source.id === id;
            })
            .classed('hover-upstream', function (link) {
                return link.target.id === id;
            });

        var nodesDownstream = _.reduce(visibleLinks, function (memo, link) {
            if (link.source.id === id) {
                memo[link.target.id] = true;
            }
            return memo;
        }, {});
        var nodesUpstream = _.reduce(visibleLinks, function (memo, link) {
            if (link.target.id === id) {
                memo[link.source.id] = true;
            }
            return memo;
        }, {});
        selectModels()
            .classed('anim', false)
            .classed('hover-downstream', function (node) {
                return nodesDownstream[node.id];
            })
            .classed('hover-upstream', function (node) {
                return nodesUpstream[node.id];
            })
            .classed('hover', function (node) {
                return node.id === id;
            });
    });

    function mousein(node) {
        T('hoveredId', node.id);
        opts.onHover(node.id);
    }

    function mouseout(node) {
        T('hoveredId', null);
        opts.onHover(null);
    }

    T(function () {
        $('#inspect').text(T.text('selectedNodeText'));
    });
    T(function () {
        var id = T('selectedId');
        selectModels()
            .classed('selected', function (node) {
                return node.id === id;
            });
    });

    function click(node) {
        T('selectedId', node.id === T('selectedId') ? null : node.id);
    }

    T(function() {
        T('screen.width');
        T('screen.height');
        var visibleLinks = T('visible.links') || [];
        var visibleNodes = T('visible.nodes') || [];

        layout.nodes(visibleNodes).edges(visibleLinks);
        layout.run();

        var graphWidth = $('#graph').outerWidth();
        var treeWidth = _.reduce(visibleNodes, function(memo, node) {
            return Math.max(memo, node.dagre.x + node.width);
        }, 0);
        var treeHeight = _.reduce(visibleNodes, function(memo, node) {
            return Math.max(memo, node.dagre.y + node.height);
        }, 0);
        widthadjcenter = 0.5 * Math.max(0, graphWidth - treeWidth);

        svg.attr('width', Math.max(treeWidth, graphWidth) + 'px');
        svg.attr('height', treeHeight + 'px');

        var linksDelta = selectLinks().data(visibleLinks, function(d) { return d.source.id + '-' + d.target.id; });
        linksDelta.exit().classed("remove", true).transition().delay(1000).remove();
        linksDelta.enter().append("path")
            .attr("d", linkloc)
            .classed("link", true);

        var nodeDelta = selectModels()
            .data(visibleNodes, function(d) { return d.id; });
        nodeDelta.exit()
            .each(function(d) {
                $(this).tooltip('destroy');
            })
            .classed("remove", true)
            .transition()
            .delay(1000)
            .remove();
        nodeDelta.enter().append("path")
            .on('mouseover', mousein)
            .on('mouseout', mouseout)
            .on('click', click)
            .attr("transform", loc);

        nodeDelta
            .attr('class', function(d) {
                return 'anim node node-' + d.id + (d.waiting ? ' waiting' : '') +
                    ' ' + (d.isView ? 'view' : 'model');
            })
            .attr("d", function(d) {
                var path;
                if (d.isView) {
                    // Draw a rectangle.
                    path = (
                        "M -W -R " +
                        "L -W R " +
                        "L W R " +
                        "L W -R " +
                        "L -W -R"
                    );
                } else {
                    // Draw a rounded rectangle.
                    path = (
                        "M -w -R" +
                        "A R R 0 0 0 -w R" +
                        "L w R" +
                        "A R R 0 0 0 w -R" +
                        "L -w -R"
                    );
                }
                return path
                    .replace(/R/g, RADIUS)
                    .replace(/w/g, Math.round(d.textwidth / 2))
                    .replace(/W/g, RADIUS + Math.round(d.textwidth / 2));
            })
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

        var textDelta = selectText().data(visibleNodes, function(d) { return d.id; });
        textDelta.exit().classed("remove", true).transition().delay(1000).remove();
        textDelta.enter().append("text")
            .attr('text-anchor', 'middle')
            .attr("y", ".28em")
            .attr("transform", loc);

        selectText()
            .text(function(d) { return d.text; });

        refreshLocsNow();
    });

    return {
        ping: function(id) {
            var $el = $('.node-' + id);
            removeClass($el[0], 'waiting');
            removeClass($el[0], 'anim');
            addClass($el[0], 'ping');
            setTimeout(function() {
                setTimeout(function() {
                    addClass($el[0], 'anim');
                    removeClass($el[0], 'ping');
                }, 400);
            }, 1);
        }
    };
}
