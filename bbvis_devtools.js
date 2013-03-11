chrome.devtools.panels.create("BBVis", "/icon.png", "/bbvis_panel.html", function(extensionPanel) {
    var _window; // Going to hold the reference to panel.html's `window`


    var data;
    var port;
    var shown;
    function restart() {
        data = [];
        port = chrome.extension.connect({ name: chrome.devtools.inspectedWindow.tabId + '' });
        port.onMessage.addListener(function(msg) {
            // On load, if the BBVis panel is currently shown, tell the page
            // to send us data.
            if (msg && msg.loaded) {
                if (shown) {
                    port.postMessage({ resend: true });
                }
            }
            // Write information to the panel, if exists.
            // If we don't have a panel reference (yet), queue the data.
            if (_window) {
                _window.receive(msg);
            } else {
                data.push(msg);
            }
        });
    }
    restart();

    extensionPanel.onShown.addListener(function tmp(panelWindow) {
        extensionPanel.onShown.removeListener(tmp); // Run once only
        shown = true;

        extensionPanel.onShown.addListener(function () {
            port.postMessage({ resend: true });
            shown = true;
        });
        extensionPanel.onHidden.addListener(function () {
            port.postMessage({ pause: true });
            shown = false;
        });

        _window = panelWindow;

        _window.restart = restart;

        _window.hover = function (id) {
            port.postMessage({ hover: id });
        };

        // Release queued data
        var msg;
        while (msg = data.shift())
            _window.receive(msg);

        restart();
    });
});
