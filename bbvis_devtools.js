chrome.devtools.panels.create("BBVis", "/icon.png", "/bbvis_panel.html", function(extensionPanel) {
    var _window; // Going to hold the reference to panel.html's `window`


    var data;
    var port;
    var shown;
    function restart() {
        data = [];
        port = chrome.extension.connect({ name: chrome.devtools.inspectedWindow.tabId + '' });
        function receive(msg) {
            // Write information to the panel, if exists.
            // If we don't have a panel reference (yet), queue the data.
            if (_window) {
                _window.receive(msg);
            } else {
                data.push(msg);
            }
        }
        port.onMessage.addListener(function(msg) {
            // On load, if the BBVis panel is currently shown, tell the page
            // to send us data.
            if (msg && msg.loaded) {
                if (shown) {
                    port.postMessage({ resend: true });
                }
            }
            receive(msg);
        });
        // function poll() {
        //     chrome.devtools.inspectedWindow.eval('window.bbvis_getmessages()', function (resp) {
        //         console.log(resp);
        //         if (resp) {
        //             for (var i = 0; i < resp.length; i++) {
        //                 receive(resp[i]);
        //             }
        //         }
        //         setTimeout(poll, 400);
        //     });
        // };
        // poll();
    }
    restart();

    function send(msg) {
        // chrome.devtools.inspectedWindow.eval('window.bbvis_send(' +
        //     JSON.stringify(msg) + ')');
        if (port) {
            port.postMessage(msg);
        }
    }

    extensionPanel.onShown.addListener(function tmp(panelWindow) {
        extensionPanel.onShown.removeListener(tmp); // Run once only
        shown = true;

        extensionPanel.onShown.addListener(function () {
            send({ resend: true });
            shown = true;
        });
        extensionPanel.onHidden.addListener(function () {
            send({ pause: true });
            shown = false;
        });

        _window = panelWindow;

        _window.restart = restart;

        _window.hover = function (id) {
            send({ hover: id });
        };

        _window.postMessage = function (msg) {
            send(msg);
        };

        // window.bbvis_getmessages = function () {
        //     console.log("YOOO");
        // };
        // window.bbvis_send = _window.bbvis_send;

        // Release queued data
        var msg;
        while (msg = data.shift())
            _window.receive(msg);

        restart();
    });
});
