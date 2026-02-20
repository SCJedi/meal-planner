(function() {
    'use strict';

    var config = {
        firebaseUrl: '',
        familyCode: '',
        enabled: false,
        syncInterval: 30000
    };

    // --- Config Persistence ---

    function loadConfig() {
        try {
            var stored = localStorage.getItem('mp_cloud_sync');
            if (stored) {
                var parsed = JSON.parse(stored);
                config.firebaseUrl = parsed.firebaseUrl || '';
                config.familyCode = parsed.familyCode || '';
                config.enabled = !!parsed.enabled;
                config.syncInterval = parsed.syncInterval || 30000;
            }
        } catch (e) {
            console.error('Failed to load sync config:', e);
        }
    }

    function saveConfig() {
        try {
            localStorage.setItem('mp_cloud_sync', JSON.stringify({
                firebaseUrl: config.firebaseUrl,
                familyCode: config.familyCode,
                enabled: config.enabled,
                syncInterval: config.syncInterval
            }));
        } catch (e) {
            console.error('Failed to save sync config:', e);
        }
    }

    // --- Path Helpers ---

    function getBasePath() {
        var base = config.firebaseUrl.replace(/\/$/, '');
        if (config.familyCode) {
            base += '/' + encodeURIComponent(config.familyCode);
        }
        return base;
    }

    // --- CRUD Operations ---

    function saveCollection(name, data) {
        if (!config.enabled || !config.firebaseUrl) return Promise.resolve();
        var url = getBasePath() + '/' + name + '.json';
        var payload = (name === 'recipes') ? stripImagesFromRecipes({ recipes: data }).recipes : data;
        return fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function(r) {
            if (!r.ok) {
                return r.text().then(function(body) {
                    throw new Error('HTTP ' + r.status + ': ' + body);
                });
            }
            updateSyncStatus('synced');
            return r.json();
        }).catch(function(err) {
            console.error('Sync error:', err);
            updateSyncStatus('error', err.message);
        });
    }

    function loadCollection(name) {
        if (!config.enabled || !config.firebaseUrl) return Promise.resolve(null);
        var url = getBasePath() + '/' + name + '.json';
        return fetch(url).then(function(r) {
            if (!r.ok) throw new Error('Load failed: ' + r.status);
            return r.json();
        }).catch(function(err) {
            console.error('Load error:', err);
            return null;
        });
    }

    function loadAll() {
        if (!config.enabled || !config.firebaseUrl) return Promise.resolve(null);
        var url = getBasePath() + '/.json';
        return fetch(url).then(function(r) {
            if (!r.ok) throw new Error('Load failed: ' + r.status);
            return r.json();
        }).catch(function(err) {
            console.error('Load all error:', err);
            return null;
        });
    }

    function stripImagesFromRecipes(data) {
        if (!data || !data.recipes) return data;
        var cleaned = Object.assign({}, data);
        cleaned.recipes = data.recipes.map(function(r) {
            if (r.image && r.image.length > 1000) {
                return Object.assign({}, r, { image: '' });
            }
            return r;
        });
        return cleaned;
    }

    function saveAll(data) {
        if (!config.enabled || !config.firebaseUrl) return Promise.resolve();
        var url = getBasePath() + '/.json';
        var payload = stripImagesFromRecipes(data);
        return fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function(r) {
            if (!r.ok) {
                return r.text().then(function(body) {
                    throw new Error('HTTP ' + r.status + ': ' + body);
                });
            }
            updateSyncStatus('synced');
            return r.json();
        }).catch(function(err) {
            console.error('Save all error:', err);
            updateSyncStatus('error', err.message);
        });
    }

    // --- Debounced Sync ---

    var _syncTimer = null;

    function debouncedSync(name, data) {
        if (_syncTimer) clearTimeout(_syncTimer);
        updateSyncStatus('pending');
        _syncTimer = setTimeout(function() {
            saveCollection(name, data);
        }, 2000);
    }

    // --- Polling for Remote Changes ---

    var _pollTimer = null;

    function startPolling(onDataReceived) {
        if (_pollTimer) clearInterval(_pollTimer);
        if (!config.enabled) return;

        _pollTimer = setInterval(function() {
            loadAll().then(function(data) {
                if (data && onDataReceived) {
                    onDataReceived(data);
                }
            });
        }, config.syncInterval);
    }

    function stopPolling() {
        if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
    }

    // --- Sync Status UI ---

    function updateSyncStatus(status, detail) {
        var el = document.getElementById('sync-status');
        if (!el) return;

        el.className = 'sync-status sync-' + status;
        var labels = {
            synced: '\u2713 Synced',
            pending: '\u27F3 Saving...',
            syncing: '\u27F3 Syncing...',
            error: '\u2715 Sync error',
            offline: '\u25CB Local only'
        };
        el.textContent = labels[status] || '';
        if (detail && status === 'error') {
            el.title = detail;
            console.error('Sync status detail:', detail);
        } else {
            el.title = '';
        }
        el.style.display = config.enabled ? '' : 'none';
    }

    // --- Test Connection ---

    function testConnection() {
        if (!config.firebaseUrl) return Promise.reject(new Error('No URL configured'));
        var url = config.firebaseUrl.replace(/\/$/, '') + '/.json';
        return fetch(url).then(function(r) {
            if (r.ok) return { success: true };
            throw new Error('HTTP ' + r.status);
        });
    }

    // --- Settings UI Wiring ---

    function wireSettingsUI() {
        var enabledCheckbox = document.getElementById('sync-enabled');
        var detailSection = document.getElementById('sync-settings-detail');
        var firebaseUrlInput = document.getElementById('sync-firebase-url');
        var familyCodeInput = document.getElementById('sync-family-code');
        var testBtn = document.getElementById('sync-test-btn');
        var pushBtn = document.getElementById('sync-push-btn');
        var pullBtn = document.getElementById('sync-pull-btn');

        if (!enabledCheckbox) return;

        // Toggle sync detail visibility
        enabledCheckbox.addEventListener('change', function(e) {
            detailSection.style.display = e.target.checked ? 'block' : 'none';
            window.CloudSync.setConfig({ enabled: e.target.checked });
        });

        // Save URL on change
        firebaseUrlInput.addEventListener('change', function(e) {
            window.CloudSync.setConfig({ firebaseUrl: e.target.value.trim() });
        });

        // Save family code on change
        familyCodeInput.addEventListener('change', function(e) {
            window.CloudSync.setConfig({ familyCode: e.target.value.trim() });
        });

        // Test connection
        testBtn.addEventListener('click', function() {
            var resultEl = document.getElementById('sync-test-result');
            resultEl.className = 'loader-status visible processing';
            resultEl.textContent = 'Testing connection...';

            window.CloudSync.testConnection().then(function() {
                resultEl.className = 'loader-status visible success';
                resultEl.textContent = '\u2713 Connected successfully!';
            }).catch(function(err) {
                resultEl.className = 'loader-status visible error';
                resultEl.textContent = '\u2715 Connection failed: ' + err.message;
            });
        });

        // Push local -> cloud
        pushBtn.addEventListener('click', function() {
            var api = window.MealPlannerAPI;
            var stateData = api && api.getStateForSync ? api.getStateForSync() : null;
            if (stateData) {
                window.CloudSync.saveAll(stateData).then(function(result) {
                    if (result) {
                        if (api && api.showAppAlert) api.showAppAlert('Local data pushed to cloud!');
                    } else {
                        if (api && api.showAppAlert) api.showAppAlert('Push failed — check the browser console (F12) for details.');
                    }
                });
            }
        });

        // Pull cloud -> local
        pullBtn.addEventListener('click', function() {
            var api = window.MealPlannerAPI;
            window.CloudSync.loadAll().then(function(data) {
                if (data) {
                    if (api && api.applyCloudData) {
                        api.applyCloudData(data);
                        if (api.showAppAlert) api.showAppAlert('Cloud data pulled to local!');
                    }
                } else {
                    if (api && api.showAppAlert) api.showAppAlert('No cloud data found.');
                }
            });
        });
    }

    // --- Populate Settings Form ---

    function populateSettingsForm() {
        var enabledCheckbox = document.getElementById('sync-enabled');
        var firebaseUrlInput = document.getElementById('sync-firebase-url');
        var familyCodeInput = document.getElementById('sync-family-code');
        var detailSection = document.getElementById('sync-settings-detail');

        if (!enabledCheckbox) return;

        enabledCheckbox.checked = config.enabled;
        firebaseUrlInput.value = config.firebaseUrl;
        familyCodeInput.value = config.familyCode || '';
        detailSection.style.display = config.enabled ? 'block' : 'none';
    }

    // --- Init ---

    function init() {
        loadConfig();
        if (config.enabled && config.firebaseUrl) {
            updateSyncStatus('syncing');
        } else {
            updateSyncStatus('offline');
        }
    }

    // Wire settings UI on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireSettingsUI);
    } else {
        wireSettingsUI();
    }

    // --- Public API ---

    window.CloudSync = {
        init: init,

        // Config
        getConfig: function() { return Object.assign({}, config); },
        setConfig: function(newConfig) {
            config = Object.assign(config, newConfig);
            saveConfig();
            if (config.enabled && config.firebaseUrl) {
                updateSyncStatus('syncing');
            } else {
                stopPolling();
                updateSyncStatus('offline');
            }
        },

        // Data operations
        saveCollection: saveCollection,
        loadCollection: loadCollection,
        saveAll: saveAll,
        loadAll: loadAll,
        debouncedSync: debouncedSync,

        // Polling
        startPolling: startPolling,
        stopPolling: stopPolling,

        // Utils
        testConnection: testConnection,
        updateStatus: updateSyncStatus,
        populateSettingsForm: populateSettingsForm
    };
})();
