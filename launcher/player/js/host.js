define(["require", "exports"], function (require, exports) {
    
    /* Generic send message interface name */
    var SendMessageInterface = 'send_message';
    /* Supported messages */
    var BrowserInvokeLoadedMessage = 'browserInvokeLoaded';
    var PreviewRenderedMessage = 'previewRendered';
    var PreviewFailedMessage = 'previewFailed';
    var PreviewLoadedMessage = 'previewLoaded';
    var ErrorMessage = 'error';
    var CloseMessage = 'close';
    var HostInvokeMessage = 'hostInvoke';
    var LogMessage = 'log';
    var ResizeMessage = 'resize';

    /* Player call message's call types */
    var HostInvoke_Config = 'Config';    

    /* Player call message's call types */
    var BrowserInvokeInterface = 'browserInvoke';

    /* The Host singleton. Provides an interface to access the player shell */
    var loaded = false;
    var send_message = null;

    function external(methodName) {
        if (!window.app) {
            console.log('Host not bound');
            return function () { };
        }

        /* Check if the send_message interface is supported */
        if (send_message == null) {
            send_message = window.app[SendMessageInterface];
        }

        var method, message_arguments, i;
        message_arguments = [];
        if (send_message == null) {
            method = window.app[methodName];
            if (!method) {
                console.log('No ' + methodName + ' method');
                return function () {
                };
            }
        } else {
            method = send_message;
            if (!method) {
                console.log('No send_message method');
                return function () {
                };
            }

            message_arguments.push(methodName);
        }

        for (i = 1; i < arguments.length; i++) {
            message_arguments.push(arguments[i]);
        }

        return method.apply(window.app, message_arguments);
    }

    function hostInvoke(method) {
        var args = new Array();
        for (var i = 1; i < arguments.length; i++) {
            args.push(encodeURIComponent(arguments[i]));
        }

        var stringArgs = args.join(' ');

        console.log('HostInvoke: "' + method + '" "' + stringArgs + '"');
        external(HostInvokeMessage, method, stringArgs);
    }

    function previewLoaded() {
        if (loaded) {
            console.log('Host already notified');
            return;
        }

        if (window.app) {
            console.log('Host available, calling previewLoaded');
            loaded = true;
            external(PreviewLoadedMessage);
        }
        else {
            // Keep trying until the binding has been stablished by the host.
            // In the case of awesomium this happens on document ready, but it seems the 
            // event is dispatched asynchronously to awesomium causing window.load to execute
            // before awesomium had a chance to execute.                                
            console.log('Host unavailable, retrying.');
            setTimeout(previewLoaded.bind(this), 50);
        }
    };

    function log() {
        external(LogMessage, arguments);
    };

    function error() {
        external(ErrorMessage, arguments);
    };

    function close() {
        external(CloseMessage, arguments);
    };

    function config(key, value) {
        hostInvoke(HostInvoke_Config, key, value);
    };

    function resize(width, height) {
        external(ResizeMessage, width + '', height + '');
    };

    function previewRendered(screenPath, stateId) {
        external(PreviewRenderedMessage, screenPath, stateId);
    };
    
    function previewFailed(screenPath, stateId) {
        external(PreviewFailedMessage, screenPath, stateId);
    };

    function exportBrowserInvoke(browserInvoke_interface) {
        var browserInvoke = function (method, args) {
            if (typeof args === "string") {
                // Compatibility with Mac which is still using string escape
                args = args.split(' ').map(decodeURIComponent);
            }

            console.log('BrowserInvoke: "' + method + '" "' + args + '"');
            if (browserInvoke_interface[method] !== undefined) {
                browserInvoke_interface[method].apply(this, args);
            }
        };

        /* Export as global function */
        window[BrowserInvokeInterface] = browserInvoke;
        external(BrowserInvokeLoadedMessage);
    };

    function getBool(value) {
        return value ? "True" : "False";
    }

    function isTrue(value) {
        return value && typeof (value) === 'string' && value.toLowerCase() === 'true';
    }

    exports.log = log;
    exports.error = error;
    exports.close = close;
    exports.config = config;
    exports.resize = resize;
    exports.previewLoaded = previewLoaded;
    exports.previewRendered = previewRendered;
    exports.previewFailed = previewFailed;
    exports.hostInvoke = hostInvoke;
    exports.exportBrowserInvoke = exportBrowserInvoke;
    exports.getBool = getBool;
    exports.isTrue = isTrue;
});