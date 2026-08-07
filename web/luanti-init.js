// Luanti Web Initialization
// This file runs BEFORE luanti.js loads and sets up the environment

console.log('***** Luanti Web Init Script Loaded *****');
self._luantiDevicePixelRatio = window.devicePixelRatio || 1.0;
console.log('Captured devicePixelRatio:', self._luantiDevicePixelRatio);

// Global Module configuration for Emscripten
// This will be read by LuantiModule() when it loads
function createLuantiModuleConfiguration() {
    const preventKeyDefault = function(e) {
        // Only prevent defaults for keys that cause unwanted browser actions
        // Allow normal typing keys to work in text fields
        
        // Special handling for F11: Let browser handle fullscreen, but block game from seeing it
        if (e.key === 'F11') {
            e.stopPropagation();
            e.stopImmediatePropagation();
            // Do NOT call preventDefault() - let browser toggle fullscreen
            return;
        }
        
        // Prevent Tab from moving focus outside the canvas
        // Luanti handles Tab internally for navigating between GUI elements
        if (e.key === 'Tab') {
            e.preventDefault();
            return;
        }
        
        // Prevent other function keys (F1-F12)
        if (e.key && e.key.startsWith('F') && e.key.length > 1 && e.key.length <= 3) {
            e.preventDefault();
            return;
        }
        
        // Prevent "/" from opening Firefox's Quick Find
        // Only block on 'keypress' — blocking on 'keydown' would suppress the
        // keypress event entirely, preventing the character from reaching Emscripten/SDL.
        if (e.key === '/' && e.type === 'keypress') {
            e.preventDefault();
            return;
        }
        
        // Prevent browser shortcuts (Ctrl/Cmd + key)
        if (e.ctrlKey || e.metaKey) {
            // Allow common text editing shortcuts
            const allowedKeys = ['a', 'c', 'v', 'x', 'z', 'y'];
            if (!allowedKeys.includes(e.key?.toLowerCase())) {
                e.preventDefault();
                return;
            }
        }
    };

    const pasteHandler = function(e) {
        let text = '';
        if (e.clipboardData && e.clipboardData.getData) {
            text = e.clipboardData.getData('text/plain');
        } else if (window.clipboardData && window.clipboardData.getData) {
            text = window.clipboardData.getData('Text');
        }
        
        if (text && text.length > 0) {
            if (typeof Module !== 'undefined' && Module._SDL_SetClipboardText) {
                const ptr = Module.stringToNewUTF8(text);
                Module._SDL_SetClipboardText(ptr);
                Module._free(ptr);
                console.log('[clipboard] Stored paste text via SDL_SetClipboardText:', text.substring(0, 30) + (text.length > 30 ? '...' : ''));
            } else if (typeof Module !== 'undefined' && Module.ccall) {
                try {
                    Module.ccall('SDL_SetClipboardText', 'number', ['string'], [text]);
                    console.log('[clipboard] Stored paste text via ccall:', text.substring(0, 30) + (text.length > 30 ? '...' : ''));
                } catch (err) {
                    console.warn('[clipboard] Failed to store paste text:', err);
                }
            }
        }
    };

    // Launch arguments can carry a server password (--password). Anything that
    // logs argv must go through this, or the secret ends up in every user's
    // devtools console.
    const SECRET_ARGS = ['--password'];
    function redactArgs(args) {
        if (!Array.isArray(args)) return args;
        const out = args.slice();
        for (let i = 0; i < out.length; i++) {
            if (SECRET_ARGS.includes(out[i]) && i + 1 < out.length) {
                out[i + 1] = '<redacted>';
            }
        }
        return out;
    }

    const Module = {
        // Preload everything but don't call main() until user clicks Run
        noInitialRun: true,
        // Store DPR in Module so it's available to worker threads
        devicePixelRatio: self._luantiDevicePixelRatio,
        canvas: (function() {
            const canvas = document.getElementById('canvas');
            canvas.addEventListener('webglcontextlost', function(e) {
                alert('WebGL context lost. Reload the page.');
                e.preventDefault();
            }, false);
            return canvas;
        })(),
        arguments: [],
        printErr: function(text) {
            console.error('stderr:', text);
        },
        print: function(text) {
            console.log('stdout:', text);
        },
        preRun: [
            function(mod) {
                console.log('***** MODULE PRERUN EXECUTING *****');
                
                // In preRun, we receive the module instance as a parameter
                const module = mod || this || Module;
                const userDataDir = '/userdata';
                
                // Set environment variables (safe to do in preRun).
                // User data lives at /userdata/luanti (under /userdata which is
                // OPFS-mounted in main()). The /luanti subdir lets future games
                // live alongside without filename collisions. Read-only bundled
                // assets are preloaded to /share — splitting share-from-user is
                // required for the OPFS mount to succeed (see emscripten-toolchain.cmake).
                const luantiUserPath = userDataDir + '/luanti';
                if (module.ENV) {
                    module.ENV.LUANTI_USER_PATH = luantiUserPath;
                    module.ENV.LUANTI_SHARE_PATH = '/share';
                    console.log('preRun: Set LUANTI_USER_PATH to:', luantiUserPath);
                    console.log('preRun: Set LUANTI_SHARE_PATH to: /share');
                }

                // Set device pixel ratio in WASM memory so the C++ side
                // can read it from any thread without cross-thread proxying.
                if (module._luanti_set_dpr) {
                    module._luanti_set_dpr(window.devicePixelRatio || 1.0);
                    console.log('preRun: Set DPR to:', window.devicePixelRatio || 1.0);
                }

                window.addEventListener('keydown', preventKeyDefault, true);
                window.addEventListener('keyup', preventKeyDefault, true);
                window.addEventListener('keypress', preventKeyDefault, true);

                document.addEventListener('paste', pasteHandler);
            }
        ],
        postRun: [],
        totalDependencies: 0,
        monitorRunDependencies: function(left) {
            if (left >= this.totalDependencies) {
                this.totalDependencies = left;
            }
            else if (left > 0) {
                LuantiStateObject.setLoadingProgress(0.95 + (((this.totalDependencies - left) / this.totalDependencies) * 0.05));
            }
            else {
                LuantiStateObject.setLoadingProgress(1);
            }
        },
        setStatus: function(status) {
            const matches = /\((\d+)\/(\d+)\)/.exec(status);
            if (matches) {
                const total = parseInt(matches[2]);
                const loaded = parseInt(matches[1]);
                LuantiStateObject.setLoadingProgress((loaded / total) * 0.95);
            }
        },
        onRuntimeInitialized: function() {
            Module.printErr('***** RUNTIME INITIALIZED *****');
            console.error('***** RUNTIME INITIALIZED *****');

            // NOTE: /userdata is mounted from OPFS inside main() (see
            // luanti/src/main.cpp). The host JS must NOT create or chdir to
            // /userdata here — that would populate it in MEMFS and block the
            // OPFS mount with EEXIST. All required subdirectories (worlds,
            // games, mods, cache, cache/cdb, client, client/serverlist,
            // __kaesual) are created by the JS-side ensureOpfsReady() in
            // OPFS before main() is called, so they're visible immediately
            // after the mount.

            LuantiStateObject.setReady();
        },
        onAbort: function(what) {
            console.error('***** ABORT CALLED *****');
            console.error('Abort reason:', what);
            console.trace('Abort stack trace');
            LuantiStateObject.abortOccurred('ABORT: ' + (what || 'Unknown error'))
        }
    };

    // Catch all uncaught errors
    const errorHandler = function(e) {
        console.error('***** UNCAUGHT ERROR *****');
        console.error('Message:', e.message);
        console.error('Filename:', e.filename);
        console.error('Line:', e.lineno, 'Col:', e.colno);
        console.error('Error object:', e.error);
        LuantiStateObject.errorOccurred('UNCAUGHT ERROR: ' + e.message);
    };
    window.addEventListener('error', errorHandler);

    const unhandledRejectionHandler = function(e) {
        console.error('***** UNHANDLED PROMISE REJECTION *****');
        console.error('Reason:', e.reason);
        LuantiStateObject.errorOccurred('PROMISE REJECTED: ' + e.reason);
    };
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    // Log that Module is configured
    console.log('***** MODULE CONFIGURED *****');
    console.log('Module.arguments:', redactArgs(Module.arguments));

    // Debounce to avoid rapid resizes
    let resizeScheduled = false;
    
    function resizeCanvasToContainer() {
        if (!Module || !Module.canvas) return;
        const canvas = Module.canvas;
        const container = document.getElementById('game-container') || canvas.parentElement || document.body;
        const displayWidth = Math.max(1, Math.floor(container.clientWidth));
        const displayHeight = Math.max(1, Math.floor(container.clientHeight));
        
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        if (typeof window !== 'undefined') {
            const currentDPR = window.devicePixelRatio || 1.0;
            if (self._luantiDevicePixelRatio !== currentDPR) {
                self._luantiDevicePixelRatio = currentDPR;
                if (Module) {
                    Module.devicePixelRatio = currentDPR;
                    // Update DPR in WASM memory for the C++ side
                    if (Module._luanti_set_dpr) {
                        Module._luanti_set_dpr(currentDPR);
                    }
                }
                console.log('Updated devicePixelRatio:', currentDPR);
            }
        }
    }
    
    function scheduleResize() {
        if (resizeScheduled) return;
        resizeScheduled = true;
        requestAnimationFrame(function() {
            resizeScheduled = false;
            try { resizeCanvasToContainer(); } catch (e) { console.warn('resizeCanvasToContainer failed:', e); }
        });
    }
    
    // Window and fullscreen events
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', scheduleResize);
    document.addEventListener('fullscreenchange', scheduleResize);
    
    try {
        resizeCanvasToContainer();
        console.log('Initial canvas resize complete');
    } catch (e) {
        console.warn('Initial resizeCanvasToContainer failed:', e);
    }
    scheduleResize();

    // Luanti control object
    let __isReadyResolve = null;
    let __isReadyReject = null;
    const LuantiStateObject = {
        __ready: false,
        isReady: new Promise(function(resolve, reject) {
            __isReadyResolve = resolve;
            __isReadyReject = reject;
        }),
        isRunning: false,
        loadingProgress: 0,
        onProgressChangeListeners: new Set(),
        onAbortListeners: new Set(),
        onJoinResultListeners: new Set(),

        /**
         * Start the game.
         *
         * @param {string[]} [args] argv for main(). Omit to boot into Luanti's
         *   main menu (the default). Pass e.g.
         *   ['--address', 'f::1', '--port', '30000',
         *    '--name', 'Char', '--password', '...', '--go']
         *   to connect straight to a server without showing the menu.
         */
        run: function(args) {
            if (this.isRunning) {
                console.log('Luanti is already running');
                return;
            }
            if (!this.__ready) {
                console.log('Luanti not yet preloaded, please wait...');
                return;
            }
            this.isRunning = true;

            const argv = Array.isArray(args) ? args : Module.arguments;
            console.log('Starting Luanti main() with:', redactArgs(argv));
            // Call main() - this starts the actual game
            try {
                if (typeof Module.callMain === 'function') {
                    Module.callMain(argv);
                } else {
                    throw new Error('Neither callMain nor _main available - rebuild with callMain in EXPORTED_RUNTIME_METHODS');
                }
            } catch (err) {
                console.error('Failed to start Luanti:', err);
                this.isRunning = false;
            }
        },

        setReady: function() {
            console.log('Luanti is ready');
            this.__ready = true;
            __isReadyResolve(true);
        },

        setLoadingProgress: function(progress) {
            this.loadingProgress = progress;
            this.onProgressChangeListeners.forEach(listener => listener(this.loadingProgress));
        },

        errorOccurred: function(error) {
            console.error('Luanti error:', error);
        },

        abortOccurred: function(error) {
            console.error('Luanti abort:', error);
            this.onAbortListeners.forEach(listener => listener(error));
        },

        addAbortListener: function(listener) {
            this.onAbortListeners.add(listener);
        },

        removeAbortListener: function(listener) {
            this.onAbortListeners.delete(listener);
        },

        addProgressChangeListener: function(listener) {
            this.onProgressChangeListeners.add(listener);
        },

        removeProgressChangeListener: function(listener) {
            this.onProgressChangeListeners.delete(listener);
        },

        /**
         * The engine finished the login handshake with a server.
         *
         * @param {{accepted: boolean, denyCode: number|null, reason: string}} result
         *   `accepted` is a successful join; otherwise `denyCode` is Luanti's
         *   AccessDeniedCode (null when the server sent none) and `reason` is
         *   the server's human-readable text.
         */
        joinResultOccurred: function(result) {
            console.log('Luanti join result:', result);
            this.onJoinResultListeners.forEach(listener => {
                try {
                    listener(result);
                } catch (err) {
                    console.error('Join result listener failed:', err);
                }
            });
        },

        addJoinResultListener: function(listener) {
            this.onJoinResultListeners.add(listener);
        },

        removeJoinResultListener: function(listener) {
            this.onJoinResultListeners.delete(listener);
        },
    };

    // Where the engine's MAIN_THREAD_ASYNC_EM_ASM callback lands
    // (src/network/clientpackethandler.cpp). It runs in the page's global
    // scope, not in this closure, so the bridge has to be a global.
    const joinResultBridge = function(result) {
        LuantiStateObject.joinResultOccurred(result);
    };
    self._luantiOnJoinResult = joinResultBridge;

    const cleanUp = function() {
        window.removeEventListener('keydown', preventKeyDefault, true);
        window.removeEventListener('keyup', preventKeyDefault, true);
        window.removeEventListener('keypress', preventKeyDefault, true);
        window.removeEventListener('error', errorHandler);
        window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
        window.removeEventListener('resize', scheduleResize);
        window.removeEventListener('orientationchange', scheduleResize);
        document.removeEventListener('fullscreenchange', scheduleResize);
        document.removeEventListener('paste', pasteHandler);
        // Only if a later instance has not already replaced it.
        if (self._luantiOnJoinResult === joinResultBridge) {
            delete self._luantiOnJoinResult;
        }
        Module.printErr('***** CLEANUP COMPLETE *****');
    };

    return {
        Module,
        LuantiStateObject,
        cleanUp,
    };
}

// Preload Luanti after luanti.js loads (downloads WASM + assets, but doesn't run main())
window.createLuantiInstance = async () => {
    while (typeof window.LuantiModule === 'undefined') {
        console.log('Waiting for LuantiModule to load...');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    try {
        const { Module, LuantiStateObject, cleanUp } = createLuantiModuleConfiguration();
        const instancePromise = LuantiModule(Module);
        console.log('LuantiModule started loading');
        return { instancePromise, LuantiStateObject, cleanUp };
    } catch (err) {
        console.error('Failed to preload LuantiModule:', err);
        throw err;
    }
};
