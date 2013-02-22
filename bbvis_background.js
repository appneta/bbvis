var devtools_ports = {};
chrome.extension.onConnect.addListener(function (devtools_port) {
    var name = devtools_port.name;
    var tabid = parseInt(name, 10);
    if (tabid) {
        // console.log('background connection received', devtools_port);
        devtools_ports[tabid] = devtools_port;
        var content_port = chrome.tabs.connect(tabid, {});
        // Remove port when destroyed (eg when devtools instance is closed)
        devtools_port.onDisconnect.addListener(function () {
            // console.log('background devtools connection closed', name);
            delete devtools_ports[tabid];
        });
        content_port.onDisconnect.addListener(function () {
            // console.log('background content connection closed', name);
        });
        devtools_port.onMessage.addListener(function (msg) {
            content_port.postMessage(msg);
            // console.log('devtools -> content', msg);
        });
        content_port.onMessage.addListener(function (msg) {
            try {
                devtools_port.postMessage(msg);
            } catch(_) {}
            // console.log('content -> devtools', msg);
        });
    }
});
chrome.extension.onMessage.addListener(function(message, sender) {
    // console.log(message, 'received from', sender);
    var tabid = sender.tab.id;
    if (devtools_ports[tabid]) {
        devtools_ports[tabid].postMessage({ reload: true });
    }
});
