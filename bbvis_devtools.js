chrome.devtools.panels.create("BBVis", "/icon.png", "/bbvis_panel.html", function(extensionPanel) {
    var _window; // Going to hold the reference to panel.html's `window`


    var data;
    var port;
    function restart() {
        data = [];
        port = chrome.extension.connect({ name: chrome.devtools.inspectedWindow.tabId + '' });
        port.onMessage.addListener(function(msg) {
            // Write information to the panel, if exists.
            // If we don't have a panel reference (yet), queue the data.
            if (_window) {
                _window.receive(msg);
            } else {
                data.push(msg);
            }
            // console.log('message received', msg);
        });
    }
    restart();
    // port.postMessage('hello from devtools');

    extensionPanel.onShown.addListener(function tmp(panelWindow) {
        extensionPanel.onShown.removeListener(tmp); // Run once only
        _window = panelWindow;

        // Just to show that it's easy to talk to pass a message back:
        _window.respond = function(msg) {
            port.postMessage(msg);
        };
        _window.restart = restart;

        // Release queued data
        var msg;
        while (msg = data.shift())
            _window.receive(msg);

        console.log('panel ready');
        restart();
    });
});

console.log('devtools.js loaded');
