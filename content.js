var script = document.createElement("script");
script.setAttribute("src", chrome.extension.getURL('/injected.js'));
document.getElementsByTagName('html')[0].appendChild(script);

var queue = [];
window.addEventListener("message", function(event) {
    // We only accept messages from ourselves
    if (event.source === window && event.data.bbvis) {
        // console.log(event.data);
        queue.push(event.data.bbvis);
    }
}, false);

chrome.extension.sendMessage('content.js load');

chrome.extension.onConnect.addListener(function(port) {
    window.postMessage({ bbvis: 'resend all' }, window.location.href);
    // console.log('content connection received ', port);
    for (var i = 0; i < queue.length; i++) {
        port.postMessage(queue[i]);
    }
    queue.length = 0;
    queue.push = function (msg) {
        port.postMessage(msg);
    };
    port.onDisconnect.addListener(function(port) {
        delete queue.push;
    });
    port.onMessage.addListener(function(msg) {
        // window.postMessage({ msg: msg }, "*");
        console.log('bbvis:', msg);
    });
});

// console.log('content.js loaded');
