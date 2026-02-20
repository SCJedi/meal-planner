(function() {
    'use strict';

    // =========================================================================
    // Recipe Loader — AI-powered recipe import from text, images, URLs, and PDFs
    // =========================================================================

    // --- State ---
    var aiSettings = { provider: 'anthropic', apiKey: '', model: '' };
    var currentImages = [];     // Array of { base64, mediaType, file } for uploaded images
    var currentMode = 'text';   // 'text' | 'image' | 'url'
    var isProcessing = false;
    var extractedRecipe = null; // Last extracted recipe data

    // --- Default models per provider ---
    var DEFAULT_MODELS = {
        anthropic: 'claude-sonnet-4-20250514',
        openai: 'gpt-4o',
        openrouter: 'anthropic/claude-sonnet-4'
    };

    // --- AI provider endpoints ---
    var ENDPOINTS = {
        anthropic: 'https://api.anthropic.com/v1/messages',
        openai: 'https://api.openai.com/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions'
    };

    // --- CORS proxy for URL fetching ---
    var CORS_PROXY = 'https://api.allorigins.win/raw?url=';

    // --- The system prompt for AI recipe extraction ---
    var EXTRACTION_PROMPT = [
        'You are a recipe extraction assistant. Extract a structured recipe from the provided input.',
        'The input may be messy text, OCR output, a blog post, or an image of a recipe card.',
        'If multiple recipes are present, extract the first/main one.',
        '',
        'Return ONLY valid JSON in this exact format (no markdown, no explanation, no code fences):',
        '{',
        '  "name": "Recipe Name",',
        '  "category": "dinner",',
        '  "servings": 4,',
        '  "ingredients": [',
        '    { "qty": "2", "unit": "cups", "item": "flour", "category": "pantry" }',
        '  ],',
        '  "steps": ["Step 1", "Step 2"]',
        '}',
        '',
        'Rules:',
        '- category must be one of: breakfast, lunch, dinner, snack, dessert. Infer from context if not stated.',
        '- servings must be an integer. Default to 4 if not stated.',
        '- qty is a STRING (supports fractions like "1/2", ranges like "2-3").',
        '- unit is a STRING (cups, tbsp, tsp, lb, oz, g, kg, ml, L, cloves, sprigs, etc.). Use empty string if no unit.',
        '- ingredient category must be one of: produce, dairy, meat, pantry, frozen, other.',
        '  Categorize intelligently: fruits/vegetables/herbs = produce, cheese/milk/butter/cream/yogurt = dairy,',
        '  chicken/beef/pork/fish/seafood/bacon = meat, flour/sugar/oil/spices/canned/rice/pasta/soy sauce = pantry,',
        '  frozen items = frozen, everything else = other.',
        '- Clean up OCR artifacts (misread characters, broken words).',
        '- steps should be clear, concise instructions as an array of strings.',
        '- If the input is in another language, extract in that language.',
        '- Return ONLY the JSON object. No other text.'
    ].join('\n');

    // Stricter retry prompt when first attempt returns invalid JSON
    var STRICT_EXTRACTION_PROMPT = EXTRACTION_PROMPT + '\n\nCRITICAL: Your previous response was not valid JSON. Return ONLY the raw JSON object. No markdown code fences. No backticks. No explanation. Just the JSON starting with { and ending with }.';


    // =========================================================================
    // Settings Management
    // =========================================================================

    function loadAISettings() {
        try {
            var stored = localStorage.getItem('mp_ai_settings');
            if (stored) {
                var parsed = JSON.parse(stored);
                aiSettings.provider = parsed.provider || 'anthropic';
                aiSettings.apiKey = parsed.apiKey || '';
                aiSettings.model = parsed.model || '';
            }
        } catch (e) {
            console.warn('RecipeLoader: Failed to load AI settings', e);
        }
    }

    function saveAISettings() {
        try {
            localStorage.setItem('mp_ai_settings', JSON.stringify(aiSettings));
        } catch (e) {
            console.warn('RecipeLoader: Failed to save AI settings', e);
        }
    }

    function getModel() {
        return aiSettings.model || DEFAULT_MODELS[aiSettings.provider] || DEFAULT_MODELS.anthropic;
    }

    // --- Model fetching for auto-populate ---
    var _fetchModelsTimer = null;

    /**
     * Fetch available models from the selected AI provider.
     * @param {string} provider - 'anthropic', 'openai', or 'openrouter'
     * @param {string} apiKey - The API key
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    function fetchModels(provider, apiKey) {
        if (!apiKey) return Promise.resolve([]);

        if (provider === 'anthropic') {
            // Anthropic doesn't have a browser-accessible models endpoint
            return Promise.resolve([
                { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
                { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
                { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' }
            ]);
        }

        if (provider === 'openai') {
            return fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': 'Bearer ' + apiKey }
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.data) return [];
                return data.data
                    .filter(function(m) {
                        return /^(gpt-|o1|o3|chatgpt)/.test(m.id) && !/instruct|realtime|audio|search/.test(m.id);
                    })
                    .map(function(m) { return { id: m.id, name: m.id }; })
                    .sort(function(a, b) { return a.id.localeCompare(b.id); });
            })
            .catch(function() { return []; });
        }

        if (provider === 'openrouter') {
            return fetch('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': 'Bearer ' + apiKey }
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.data) return [];
                return data.data
                    .map(function(m) { return { id: m.id, name: m.name || m.id }; })
                    .sort(function(a, b) { return a.name.localeCompare(b.name); });
            })
            .catch(function() { return []; });
        }

        return Promise.resolve([]);
    }

    /**
     * Populate the model dropdown with fetched models.
     * @param {Array<{id: string, name: string}>} models
     */
    function populateModelDropdown(models) {
        var select = document.getElementById('ai-model-select');
        var customInput = document.getElementById('ai-model-input');
        if (!select) return;

        // Clear existing options
        select.innerHTML = '';

        // Add default option
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '(Default: ' + (DEFAULT_MODELS[aiSettings.provider] || '') + ')';
        select.appendChild(defaultOpt);

        // Add fetched models
        models.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            select.appendChild(opt);
        });

        // Add custom option
        var customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = 'Custom model...';
        select.appendChild(customOpt);

        // Select the current model if it matches
        if (aiSettings.model) {
            var found = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === aiSettings.model) {
                    select.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) {
                // Model is set but not in the list -- select Custom and show input
                select.value = '__custom__';
                if (customInput) {
                    customInput.style.display = '';
                    customInput.value = aiSettings.model;
                }
            } else {
                if (customInput) customInput.style.display = 'none';
            }
        } else {
            select.selectedIndex = 0;
            if (customInput) customInput.style.display = 'none';
        }
    }

    /**
     * Trigger model fetching with a loading indicator in the dropdown.
     */
    function triggerModelFetch() {
        var select = document.getElementById('ai-model-select');
        if (select) {
            select.innerHTML = '<option value="">Fetching models...</option>';
        }

        fetchModels(aiSettings.provider, aiSettings.apiKey).then(function(models) {
            populateModelDropdown(models);
        });
    }

    /**
     * Populate settings inputs in the settings modal and bind change handlers.
     * Called on init and whenever settings modal opens.
     */
    function setupSettingsBindings() {
        var providerSelect = document.getElementById('ai-provider-select');
        var apiKeyInput = document.getElementById('ai-api-key-input');
        var modelSelect = document.getElementById('ai-model-select');
        var modelInput = document.getElementById('ai-model-input');

        if (!providerSelect || !apiKeyInput) return;

        // Set current values
        providerSelect.value = aiSettings.provider;
        apiKeyInput.value = aiSettings.apiKey;
        var hintEl = document.getElementById('ai-model-hint');
        if (hintEl) {
            hintEl.textContent = 'Default: ' + (DEFAULT_MODELS[aiSettings.provider] || '');
        }

        // If there's an API key, fetch models immediately
        if (aiSettings.apiKey) {
            triggerModelFetch();
        } else if (modelSelect) {
            // No API key -- show default placeholder
            populateModelDropdown([]);
        }

        // Bind change events (use a flag to avoid duplicate bindings)
        if (!providerSelect._rlBound) {
            providerSelect.addEventListener('change', function() {
                aiSettings.provider = this.value;
                // Reset model when switching providers
                aiSettings.model = '';
                if (modelInput) {
                    modelInput.value = '';
                    modelInput.style.display = 'none';
                }
                var hintEl = document.getElementById('ai-model-hint');
                if (hintEl) {
                    hintEl.textContent = 'Default: ' + (DEFAULT_MODELS[aiSettings.provider] || '');
                }
                saveAISettings();
                // Fetch models for new provider
                if (aiSettings.apiKey) {
                    triggerModelFetch();
                } else {
                    populateModelDropdown([]);
                }
            });
            providerSelect._rlBound = true;
        }

        if (!apiKeyInput._rlBound) {
            // Save key on every keystroke
            apiKeyInput.addEventListener('input', function() {
                aiSettings.apiKey = this.value.trim();
                saveAISettings();
            });
            // Debounced model fetch: fetch 1 second after user stops typing
            apiKeyInput.addEventListener('input', function() {
                clearTimeout(_fetchModelsTimer);
                var key = this.value.trim();
                if (key.length > 10) {
                    _fetchModelsTimer = setTimeout(function() {
                        triggerModelFetch();
                    }, 1000);
                }
            });
            // Also fetch on blur/change for quick paste scenarios
            apiKeyInput.addEventListener('change', function() {
                clearTimeout(_fetchModelsTimer);
                if (this.value.trim().length > 10) {
                    triggerModelFetch();
                }
            });
            apiKeyInput._rlBound = true;
        }

        if (modelSelect && !modelSelect._rlBound) {
            modelSelect.addEventListener('change', function() {
                if (this.value === '__custom__') {
                    // Show custom text input
                    if (modelInput) {
                        modelInput.style.display = '';
                        modelInput.focus();
                    }
                } else {
                    // Hide custom input and save selected model
                    if (modelInput) modelInput.style.display = 'none';
                    aiSettings.model = this.value;
                    saveAISettings();
                }
            });
            modelSelect._rlBound = true;
        }

        if (modelInput && !modelInput._rlBound) {
            modelInput.addEventListener('input', function() {
                aiSettings.model = this.value.trim();
                saveAISettings();
            });
            modelInput._rlBound = true;
        }
    }


    // =========================================================================
    // Image Utilities
    // =========================================================================

    /**
     * Read a File as base64 data URL.
     * Returns a Promise resolving to { base64, mediaType, dataUrl }.
     */
    function readFileAsBase64(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var dataUrl = e.target.result;
                var parts = dataUrl.split(',');
                var meta = parts[0]; // e.g. "data:image/jpeg;base64"
                var base64 = parts[1];
                var mediaType = meta.replace('data:', '').replace(';base64', '');
                resolve({ base64: base64, mediaType: mediaType, dataUrl: dataUrl });
            };
            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + file.name));
            };
            reader.readAsDataURL(file);
        });
    }

    /**
     * Resize an image (as base64 data URL) to fit within maxDim pixels on its longest side.
     * Returns a Promise resolving to { base64, mediaType, dataUrl }.
     */
    function resizeImage(dataUrl, maxDim) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() {
                var w = img.width;
                var h = img.height;

                // Only resize if exceeds maxDim
                if (w <= maxDim && h <= maxDim) {
                    // Still need to re-encode to ensure consistent format
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    var resized = canvas.toDataURL('image/jpeg', 0.85);
                    var parts = resized.split(',');
                    resolve({
                        base64: parts[1],
                        mediaType: 'image/jpeg',
                        dataUrl: resized
                    });
                    return;
                }

                var ratio = Math.min(maxDim / w, maxDim / h);
                var newW = Math.round(w * ratio);
                var newH = Math.round(h * ratio);

                var canvas = document.createElement('canvas');
                canvas.width = newW;
                canvas.height = newH;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, newW, newH);

                var resized = canvas.toDataURL('image/jpeg', 0.85);
                var parts = resized.split(',');
                resolve({
                    base64: parts[1],
                    mediaType: 'image/jpeg',
                    dataUrl: resized
                });
            };
            img.onerror = function() {
                reject(new Error('Failed to load image for resizing'));
            };
            img.src = dataUrl;
        });
    }


    // =========================================================================
    // AI API Calls
    // =========================================================================

    /**
     * Build the messages payload for the AI provider.
     * @param {string} textContent - Text to include in the prompt
     * @param {Array} images - Array of { base64, mediaType } objects
     * @param {string} prompt - The extraction prompt to use
     * @returns {object} The request body for the provider
     */
    function buildRequestBody(textContent, images, prompt) {
        var model = getModel();
        var contentParts = [];

        if (aiSettings.provider === 'anthropic') {
            // Anthropic format
            images.forEach(function(img) {
                contentParts.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: img.mediaType,
                        data: img.base64
                    }
                });
            });

            var textPayload = prompt;
            if (textContent) {
                textPayload += '\n\nHere is the recipe text to extract:\n\n' + textContent;
            } else if (images.length > 0) {
                textPayload += '\n\nExtract the recipe from the image(s) above.';
            }

            contentParts.push({ type: 'text', text: textPayload });

            return {
                model: model,
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: contentParts
                }]
            };
        } else {
            // OpenAI / OpenRouter format
            images.forEach(function(img) {
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: 'data:' + img.mediaType + ';base64,' + img.base64
                    }
                });
            });

            var textPayload = prompt;
            if (textContent) {
                textPayload += '\n\nHere is the recipe text to extract:\n\n' + textContent;
            } else if (images.length > 0) {
                textPayload += '\n\nExtract the recipe from the image(s) above.';
            }

            contentParts.push({ type: 'text', text: textPayload });

            return {
                model: model,
                max_completion_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: contentParts
                }]
            };
        }
    }

    /**
     * Build headers for the API request.
     */
    function buildHeaders() {
        var headers = { 'Content-Type': 'application/json' };

        if (aiSettings.provider === 'anthropic') {
            headers['x-api-key'] = aiSettings.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
        } else {
            // OpenAI and OpenRouter use Bearer token
            headers['Authorization'] = 'Bearer ' + aiSettings.apiKey;
        }

        return headers;
    }

    /**
     * Extract the text response from the AI provider's response JSON.
     */
    function extractResponseText(provider, data) {
        if (provider === 'anthropic') {
            if (data.content && data.content.length > 0) {
                return data.content[0].text || '';
            }
            return '';
        } else {
            if (data.choices && data.choices.length > 0) {
                return data.choices[0].message.content || '';
            }
            return '';
        }
    }

    /**
     * Call the AI API and return the parsed recipe JSON.
     * @param {string} textContent - Text input
     * @param {Array} images - Array of { base64, mediaType }
     * @returns {Promise<object>} The parsed recipe object
     */
    function callAI(textContent, images) {
        var endpoint = ENDPOINTS[aiSettings.provider];
        var body = buildRequestBody(textContent, images, EXTRACTION_PROMPT);
        var headers = buildHeaders();

        return fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        })
        .then(function(response) {
            if (!response.ok) {
                return response.json().then(function(errData) {
                    var msg = 'API error';
                    if (errData.error) {
                        msg = errData.error.message || errData.error.type || JSON.stringify(errData.error);
                    }
                    throw new Error(msg);
                }).catch(function(e) {
                    if (e.message && e.message !== 'API error') throw e;
                    throw new Error('API request failed with status ' + response.status);
                });
            }
            return response.json();
        })
        .then(function(data) {
            var text = extractResponseText(aiSettings.provider, data);
            return parseRecipeJSON(text);
        })
        .then(function(recipe) {
            if (recipe) return recipe;

            // Retry with stricter prompt
            var retryBody = buildRequestBody(textContent, images, STRICT_EXTRACTION_PROMPT);
            return fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(retryBody)
            })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('AI retry failed with status ' + response.status);
                }
                return response.json();
            })
            .then(function(data) {
                var text = extractResponseText(aiSettings.provider, data);
                var recipe = parseRecipeJSON(text);
                if (!recipe) {
                    throw new Error('Could not extract a valid recipe from the AI response. Please try again with clearer input.');
                }
                return recipe;
            });
        });
    }

    /**
     * Parse AI response text into a recipe object.
     * Handles responses that may include markdown code fences or extra text.
     * Returns null if parsing fails.
     */
    function parseRecipeJSON(text) {
        if (!text) return null;

        // Try direct parse first
        try {
            return validateRecipe(JSON.parse(text));
        } catch (e) {
            // Continue with cleanup
        }

        // Strip markdown code fences if present
        var cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        try {
            return validateRecipe(JSON.parse(cleaned));
        } catch (e) {
            // Continue
        }

        // Try to find JSON object in the text
        var jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return validateRecipe(JSON.parse(jsonMatch[0]));
            } catch (e) {
                // Fall through
            }
        }

        return null;
    }

    /**
     * Validate and normalize a recipe object to match the expected schema.
     * Returns the normalized recipe or null if invalid.
     */
    function validateRecipe(obj) {
        if (!obj || typeof obj !== 'object') return null;

        var validCategories = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
        var validIngCategories = ['produce', 'dairy', 'meat', 'pantry', 'frozen', 'other'];

        var recipe = {
            name: String(obj.name || 'Untitled Recipe').trim(),
            category: validCategories.indexOf(obj.category) !== -1 ? obj.category : 'dinner',
            servings: parseInt(obj.servings) || 4,
            ingredients: [],
            steps: []
        };

        // Normalize ingredients
        if (Array.isArray(obj.ingredients)) {
            recipe.ingredients = obj.ingredients.map(function(ing) {
                if (!ing || typeof ing !== 'object') return null;
                return {
                    qty: String(ing.qty || '').trim(),
                    unit: String(ing.unit || '').trim(),
                    item: String(ing.item || '').trim(),
                    category: validIngCategories.indexOf(ing.category) !== -1 ? ing.category : 'other'
                };
            }).filter(function(ing) {
                return ing && ing.item;
            });
        }

        // Normalize steps
        if (Array.isArray(obj.steps)) {
            recipe.steps = obj.steps.map(function(step) {
                return String(step || '').trim();
            }).filter(function(step) {
                return step.length > 0;
            });
        }

        // Require at least a name
        if (!recipe.name || recipe.name === 'Untitled Recipe') {
            // Still allow it, but it must have some content
            if (recipe.ingredients.length === 0 && recipe.steps.length === 0) {
                return null;
            }
        }

        return recipe;
    }


    // =========================================================================
    // URL Processing
    // =========================================================================

    /**
     * Fetch a recipe URL via CORS proxy, try JSON-LD extraction, fall back to AI.
     * Requires AI to be configured (for the non-JSON-LD fallback).
     */
    function processURL(url) {
        setStatus('Fetching URL...', 'info');

        return fetch(CORS_PROXY + encodeURIComponent(url))
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('CORS_FETCH_FAILED');
                }
                return response.text();
            })
            .then(function(html) {
                // Try JSON-LD extraction first
                var jsonLdRecipe = extractJsonLd(html);
                if (jsonLdRecipe) {
                    setStatus('Found structured recipe data!', 'success');
                    return jsonLdRecipe;
                }

                // Fall back to AI extraction from HTML text
                setStatus('No structured data found. Sending to AI...', 'info');
                var textContent = extractTextFromHTML(html);

                if (!textContent || textContent.length < 20) {
                    throw new Error('Could not extract meaningful text from that URL. Try copying and pasting the recipe text instead.');
                }

                // Truncate very long text to avoid token limits
                if (textContent.length > 15000) {
                    textContent = textContent.substring(0, 15000);
                }

                return callAI(textContent, []);
            })
            .catch(function(err) {
                if (err.message === 'CORS_FETCH_FAILED') {
                    throw new Error("Couldn't fetch that URL. Try copying and pasting the recipe text instead.");
                }
                throw err;
            });
    }

    /**
     * Extract JSON-LD Recipe data from HTML string.
     * Returns normalized recipe object or null.
     */
    function extractJsonLd(html) {
        // Use DOMParser to safely parse HTML
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var scripts = doc.querySelectorAll('script[type="application/ld+json"]');

        for (var i = 0; i < scripts.length; i++) {
            try {
                var data = JSON.parse(scripts[i].textContent);
                var recipe = findRecipeInJsonLd(data);
                if (recipe) return recipe;
            } catch (e) {
                continue;
            }
        }

        return null;
    }

    /**
     * Recursively search JSON-LD data for a Recipe object.
     */
    function findRecipeInJsonLd(data) {
        if (!data) return null;

        // Handle arrays (e.g., @graph)
        if (Array.isArray(data)) {
            for (var i = 0; i < data.length; i++) {
                var result = findRecipeInJsonLd(data[i]);
                if (result) return result;
            }
            return null;
        }

        // Check if this is a Recipe
        if (data['@type'] === 'Recipe' || (Array.isArray(data['@type']) && data['@type'].indexOf('Recipe') !== -1)) {
            return convertJsonLdRecipe(data);
        }

        // Check @graph
        if (data['@graph']) {
            return findRecipeInJsonLd(data['@graph']);
        }

        return null;
    }

    /**
     * Convert a schema.org JSON-LD Recipe to our format.
     */
    function convertJsonLdRecipe(ld) {
        var validCategories = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
        var name = ld.name || 'Untitled Recipe';

        // Infer category from recipeCategory or keywords
        var category = 'dinner';
        var rawCategory = (ld.recipeCategory || '').toLowerCase();
        for (var i = 0; i < validCategories.length; i++) {
            if (rawCategory.indexOf(validCategories[i]) !== -1) {
                category = validCategories[i];
                break;
            }
        }

        // Servings
        var servings = 4;
        if (ld.recipeYield) {
            var yieldStr = Array.isArray(ld.recipeYield) ? ld.recipeYield[0] : ld.recipeYield;
            var parsed = parseInt(yieldStr);
            if (!isNaN(parsed) && parsed > 0) servings = parsed;
        }

        // Ingredients
        var ingredients = [];
        if (Array.isArray(ld.recipeIngredient)) {
            ingredients = ld.recipeIngredient.map(function(ingStr) {
                return parseIngredientString(String(ingStr));
            });
        }

        // Steps
        var steps = [];
        if (Array.isArray(ld.recipeInstructions)) {
            ld.recipeInstructions.forEach(function(inst) {
                if (typeof inst === 'string') {
                    steps.push(inst.trim());
                } else if (inst && inst.text) {
                    steps.push(inst.text.trim());
                } else if (inst && inst['@type'] === 'HowToSection' && Array.isArray(inst.itemListElement)) {
                    inst.itemListElement.forEach(function(subInst) {
                        if (typeof subInst === 'string') {
                            steps.push(subInst.trim());
                        } else if (subInst && subInst.text) {
                            steps.push(subInst.text.trim());
                        }
                    });
                }
            });
        } else if (typeof ld.recipeInstructions === 'string') {
            // Some sites put all instructions in a single string
            steps = ld.recipeInstructions.split(/\n+/).map(function(s) {
                return s.trim();
            }).filter(function(s) {
                return s.length > 0;
            });
        }

        return {
            name: name,
            category: category,
            servings: servings,
            ingredients: ingredients,
            steps: steps
        };
    }

    /**
     * Parse a freeform ingredient string like "2 cups all-purpose flour" into structured form.
     */
    function parseIngredientString(str) {
        str = str.trim();

        // Common units for matching
        var unitPattern = /^([\d\s\/\.\-]+)\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|cloves?|sprigs?|cans?|packages?|pieces?|slices?|pinch(?:es)?|dash(?:es)?|bunch(?:es)?|heads?|stalks?|sticks?|whole|large|medium|small)\s+(.+)/i;

        var match = str.match(unitPattern);
        if (match) {
            return {
                qty: match[1].trim(),
                unit: match[2].trim().toLowerCase(),
                item: match[3].trim(),
                category: guessIngredientCategory(match[3].trim())
            };
        }

        // Try just a number + item
        var numMatch = str.match(/^([\d\s\/\.\-]+)\s+(.+)/);
        if (numMatch) {
            return {
                qty: numMatch[1].trim(),
                unit: '',
                item: numMatch[2].trim(),
                category: guessIngredientCategory(numMatch[2].trim())
            };
        }

        // No quantity found
        return {
            qty: '',
            unit: '',
            item: str,
            category: guessIngredientCategory(str)
        };
    }

    /**
     * Guess ingredient category from the item name.
     */
    function guessIngredientCategory(item) {
        var lower = item.toLowerCase();

        // Produce
        var produceTerms = ['lettuce', 'tomato', 'onion', 'garlic', 'pepper', 'carrot', 'celery',
            'potato', 'apple', 'banana', 'lemon', 'lime', 'orange', 'herb', 'basil', 'cilantro',
            'parsley', 'mint', 'thyme', 'rosemary', 'dill', 'chive', 'ginger', 'avocado', 'spinach',
            'kale', 'broccoli', 'cauliflower', 'cucumber', 'zucchini', 'squash', 'mushroom',
            'corn', 'peas', 'beans', 'cabbage', 'beet', 'radish', 'turnip', 'scallion',
            'shallot', 'leek', 'asparagus', 'artichoke', 'eggplant', 'jalape', 'berry',
            'strawberr', 'blueberr', 'raspberr', 'blackberr', 'peach', 'pear', 'mango',
            'pineapple', 'grape', 'melon', 'watermelon', 'cantaloupe', 'fig', 'plum',
            'cherry', 'cranberr', 'fresh'];

        // Dairy
        var dairyTerms = ['milk', 'cream', 'cheese', 'butter', 'yogurt', 'sour cream',
            'ricotta', 'mozzarella', 'parmesan', 'cheddar', 'whipping cream', 'half and half',
            'half-and-half', 'cottage cheese', 'cream cheese', 'ghee', 'buttermilk'];

        // Meat
        var meatTerms = ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'salmon',
            'tuna', 'shrimp', 'prawn', 'crab', 'lobster', 'clam', 'mussel', 'oyster',
            'scallop', 'bacon', 'sausage', 'ham', 'steak', 'ground', 'veal', 'duck',
            'venison', 'bison', 'anchov', 'sardine', 'cod', 'halibut', 'tilapia',
            'trout', 'mahi', 'sea bass', 'squid', 'octopus', 'chorizo', 'pancetta',
            'prosciutto', 'pepperoni', 'salami'];

        // Frozen
        var frozenTerms = ['frozen', 'ice cream', 'popsicle', 'ice'];

        // Pantry (catch-all for shelf-stable)
        var pantryTerms = ['flour', 'sugar', 'salt', 'pepper', 'oil', 'vinegar', 'soy sauce',
            'sauce', 'paste', 'can ', 'canned', 'rice', 'pasta', 'noodle', 'bread', 'tortilla',
            'spice', 'seasoning', 'cumin', 'paprika', 'cinnamon', 'nutmeg', 'oregano',
            'powder', 'baking', 'yeast', 'cornstarch', 'broth', 'stock', 'bouillon',
            'honey', 'maple', 'syrup', 'jam', 'jelly', 'mustard', 'ketchup', 'mayo',
            'mayonnaise', 'sriracha', 'hot sauce', 'worcestershire', 'extract', 'vanilla',
            'cocoa', 'chocolate', 'chip', 'nut', 'almond', 'walnut', 'pecan', 'peanut',
            'cashew', 'pistachio', 'seed', 'sesame', 'oat', 'cereal', 'granola',
            'cracker', 'crumb', 'panko', 'breadcrumb', 'coconut', 'lentil', 'chickpea',
            'bean', 'dried', 'canned', 'wine', 'beer', 'liquor', 'rum', 'whiskey'];

        for (var i = 0; i < frozenTerms.length; i++) {
            if (lower.indexOf(frozenTerms[i]) !== -1) return 'frozen';
        }
        for (var i = 0; i < dairyTerms.length; i++) {
            if (lower.indexOf(dairyTerms[i]) !== -1) return 'dairy';
        }
        for (var i = 0; i < meatTerms.length; i++) {
            if (lower.indexOf(meatTerms[i]) !== -1) return 'meat';
        }
        for (var i = 0; i < produceTerms.length; i++) {
            if (lower.indexOf(produceTerms[i]) !== -1) return 'produce';
        }
        for (var i = 0; i < pantryTerms.length; i++) {
            if (lower.indexOf(pantryTerms[i]) !== -1) return 'pantry';
        }

        return 'other';
    }

    /**
     * Extract plain text from HTML, stripping tags and excess whitespace.
     */
    function extractTextFromHTML(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // Remove scripts, styles, nav, footer, ads
        var removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside',
            '[class*="ad-"]', '[class*="advertisement"]', '[class*="sidebar"]',
            '[class*="comment"]', '[class*="social"]', '[class*="share"]'];
        removeSelectors.forEach(function(sel) {
            try {
                doc.querySelectorAll(sel).forEach(function(el) { el.remove(); });
            } catch (e) {
                // Ignore invalid selectors
            }
        });

        var text = doc.body ? doc.body.textContent : '';
        // Collapse whitespace
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    }


    // =========================================================================
    // Local Recipe Parsing (no AI required)
    // =========================================================================

    /**
     * Unicode fraction map for converting special characters to decimal values.
     */
    var UNICODE_FRACTIONS = {
        '\u00BD': 0.5,   // ½
        '\u2153': 0.333,  // ⅓
        '\u00BC': 0.25,  // ¼
        '\u2154': 0.667,  // ⅔
        '\u00BE': 0.75,  // ¾
        '\u2155': 0.2,   // ⅕
        '\u2156': 0.4,   // ⅖
        '\u2157': 0.6,   // ⅗
        '\u2158': 0.8,   // ⅘
        '\u2159': 0.167,  // ⅙
        '\u215A': 0.833,  // ⅚
        '\u215B': 0.125,  // ⅛
        '\u215C': 0.375,  // ⅜
        '\u215D': 0.625,  // ⅝
        '\u215E': 0.875   // ⅞
    };

    /**
     * Convert a quantity string (possibly with unicode fractions) to a normalized string.
     * E.g. "1½" → "1 1/2", "⅔" → "2/3"
     */
    function normalizeQtyString(str) {
        str = str.trim();
        var result = '';
        for (var i = 0; i < str.length; i++) {
            var ch = str[i];
            if (UNICODE_FRACTIONS[ch] !== undefined) {
                var val = UNICODE_FRACTIONS[ch];
                // Convert decimal back to fraction string
                var fracStr = decimalToFraction(val);
                if (result.length > 0 && result[result.length - 1] !== ' ') {
                    result += ' ';
                }
                result += fracStr;
            } else {
                result += ch;
            }
        }
        return result.trim();
    }

    /**
     * Convert a decimal to a simple fraction string.
     */
    function decimalToFraction(val) {
        var fracs = [
            [1, 2, 0.5], [1, 3, 0.333], [2, 3, 0.667], [1, 4, 0.25], [3, 4, 0.75],
            [1, 5, 0.2], [2, 5, 0.4], [3, 5, 0.6], [4, 5, 0.8],
            [1, 6, 0.167], [5, 6, 0.833], [1, 8, 0.125], [3, 8, 0.375],
            [5, 8, 0.625], [7, 8, 0.875]
        ];
        for (var i = 0; i < fracs.length; i++) {
            if (Math.abs(val - fracs[i][2]) < 0.01) {
                return fracs[i][0] + '/' + fracs[i][1];
            }
        }
        return String(val);
    }

    /**
     * Parse a freeform recipe text locally using regex and heuristics.
     * Returns a recipe object: { name, category, servings, ingredients, steps }
     *
     * This is intended to work without any AI — it handles standard recipe formats,
     * OCR text, and minimal formatting. For better results, use AI extraction.
     */
    function parseRecipeLocally(text) {
        if (!text || typeof text !== 'string') {
            return { name: 'Untitled Recipe', category: 'dinner', servings: 4, ingredients: [], steps: [] };
        }

        var lines = text.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

        if (lines.length === 0) {
            return { name: 'Untitled Recipe', category: 'dinner', servings: 4, ingredients: [], steps: [] };
        }

        var name = '';
        var servings = 4;
        var category = 'dinner';
        var ingredients = [];
        var steps = [];

        // --- Section header patterns ---
        var ingredientHeaders = /^(?:ingredients|what you(?:'ll| will)?\s*need|shopping list|you will need|grocery list)[:\s]*$/i;
        var stepHeaders = /^(?:instructions|directions|steps|method|preparation|how to (?:make|cook|prepare)|procedure|cooking (?:instructions|method|steps|directions))[:\s]*$/i;
        var nameHeaders = /^(?:recipe(?:\s*name)?|title)[:\s]+(.+)/i;
        var notesHeaders = /^(?:notes?|tips?|variations?|nutrition|nutritional|per serving|calories)[:\s]*$/i;

        // --- Servings detection pattern ---
        var servingsPattern = /(?:serves?|servings?|makes?|yield|portions?)[:\s]*(\d+)/i;

        // --- Category keyword map ---
        var categoryKeywords = {
            breakfast: ['breakfast', 'pancake', 'waffle', 'omelet', 'omelette', 'scrambl', 'french toast',
                'cereal', 'oatmeal', 'granola', 'muffin', 'bagel', 'toast', 'eggs benedict',
                'frittata', 'crepe', 'brunch', 'hashbrown', 'hash brown', 'smoothie bowl',
                'breakfast burrito', 'bacon and eggs', 'morning'],
            lunch: ['sandwich', 'wrap', 'salad', 'soup', 'lunch', 'panini', 'sub',
                'quesadilla', 'burger', 'hot dog', 'pita', 'club'],
            dessert: ['dessert', 'cake', 'cookie', 'brownie', 'pie', 'tart', 'pastry',
                'pudding', 'ice cream', 'custard', 'fudge', 'truffle', 'mousse',
                'cheesecake', 'cupcake', 'macaron', 'cobbler', 'crisp', 'crumble',
                'sorbet', 'gelato', 'donut', 'doughnut', 'sweet', 'frosting', 'icing',
                'chocolate', 'candy', 'confection', 'meringue', 'souffl'],
            snack: ['snack', 'dip', 'appetizer', 'finger food', 'popcorn', 'nachos',
                'guacamole', 'hummus', 'bruschetta', 'trail mix', 'energy bar',
                'energy ball', 'chips', 'crackers', 'bites']
        };

        // --- Ingredient line detection patterns ---
        // Matches lines that start with a quantity (number, fraction, or unicode fraction)
        var unicodeFracChars = '\u00BC\u00BD\u00BE\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E';
        var qtyStartPattern = new RegExp('^[\\d' + unicodeFracChars + ']');

        // Full ingredient line pattern: qty [unit] item
        var fullIngPattern = new RegExp(
            '^([\\d\\s\\/\\.\\-' + unicodeFracChars + ']+)' +  // qty (numbers, fractions, ranges)
            '(?:\\s*\\(([^)]+)\\)\\s*)?' +                       // optional parenthetical e.g. (14 oz)
            '\\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|cloves?|sprigs?|cans?|packages?|pkg|pieces?|pcs?|slices?|pinch(?:es)?|dash(?:es)?|bunch(?:es)?|heads?|stalks?|sticks?|whole|large|medium|small|quarts?|qt|pints?|pt|gallons?|gal|drops?|handfuls?|containers?|bottles?|jars?|bags?|boxes?|cups?|c\\.)?' +  // optional unit
            '\\s+(.+)',                                           // item
            'i'
        );

        // Pattern for "1 (14 oz) can diced tomatoes" style
        var parenUnitPattern = new RegExp(
            '^([\\d\\s\\/\\.\\-' + unicodeFracChars + ']+)' +   // qty
            '\\s*\\(([^)]+)\\)' +                                 // parenthetical (14 oz)
            '\\s*(cans?|jars?|bottles?|packages?|pkg|bags?|boxes?|containers?)?' + // optional container
            '\\s+(.+)',                                           // item
            'i'
        );

        // Bullet/dash list item pattern
        var bulletPattern = /^[\u2022\u2023\u25E6\u2043\u2219\-\*\u2013\u2014]\s*/;

        // Numbered step pattern
        var numberedStepPattern = /^(?:step\s*)?\d+[\.\)\:\-]\s*/i;

        // --- Pass 1: Detect servings and category from full text ---
        var fullText = text.toLowerCase();
        var servingsMatch = fullText.match(servingsPattern);
        if (servingsMatch) {
            var s = parseInt(servingsMatch[1]);
            if (s > 0 && s <= 100) servings = s;
        }

        // Detect category
        var detectedCategory = null;
        var categoryKeys = Object.keys(categoryKeywords);
        for (var ci = 0; ci < categoryKeys.length; ci++) {
            var catKey = categoryKeys[ci];
            var terms = categoryKeywords[catKey];
            for (var ti = 0; ti < terms.length; ti++) {
                if (fullText.indexOf(terms[ti]) !== -1) {
                    detectedCategory = catKey;
                    break;
                }
            }
            if (detectedCategory) break;
        }
        if (detectedCategory) category = detectedCategory;

        // --- Pass 2: Line-by-line parsing ---
        var currentSection = 'unknown'; // 'unknown', 'name', 'ingredients', 'steps', 'notes'
        var nameFound = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];

            // Skip very short lines that are likely noise/artifacts
            if (line.length <= 1) continue;

            // Check for explicit name header: "Recipe: Chicken Soup"
            var nameMatch = line.match(nameHeaders);
            if (nameMatch && !nameFound) {
                name = nameMatch[1].trim();
                nameFound = true;
                continue;
            }

            // Check for section headers
            if (ingredientHeaders.test(line)) {
                currentSection = 'ingredients';
                continue;
            }
            if (stepHeaders.test(line)) {
                currentSection = 'steps';
                continue;
            }
            if (notesHeaders.test(line)) {
                currentSection = 'notes';
                continue;
            }

            // Check for servings on this line
            var lineServMatch = line.match(servingsPattern);
            if (lineServMatch) {
                var sv = parseInt(lineServMatch[1]);
                if (sv > 0 && sv <= 100) servings = sv;
                // If this line is ONLY the servings info, skip it
                if (line.replace(servingsPattern, '').trim().length < 5) continue;
            }

            // Skip notes section
            if (currentSection === 'notes') continue;

            // --- Determine recipe name ---
            if (!nameFound && currentSection === 'unknown') {
                // First significant line that doesn't look like an ingredient or step
                if (!qtyStartPattern.test(line) && !numberedStepPattern.test(line) && !bulletPattern.test(line)) {
                    // Looks like a title — not a measurement, not a numbered step
                    if (line.length < 120 && line.length > 1) {
                        name = line.replace(/^(recipe|title)[:\s]*/i, '');
                        nameFound = true;
                        continue;
                    }
                }
            }

            // --- Parse ingredient lines ---
            if (currentSection === 'ingredients' || currentSection === 'unknown') {
                var ingredient = tryParseIngredientLine(line, bulletPattern, fullIngPattern, parenUnitPattern, qtyStartPattern, unicodeFracChars);
                if (ingredient) {
                    if (currentSection === 'unknown') currentSection = 'ingredients';
                    ingredients.push(ingredient);
                    continue;
                }
            }

            // --- Parse step lines ---
            if (currentSection === 'steps' || currentSection === 'unknown') {
                // Check for numbered steps
                if (numberedStepPattern.test(line)) {
                    var stepText = line.replace(numberedStepPattern, '').trim();
                    if (stepText.length > 5) {
                        if (currentSection === 'unknown') currentSection = 'steps';
                        steps.push(stepText);
                        continue;
                    }
                }

                // In the steps section, any non-header line is a step
                if (currentSection === 'steps') {
                    var cleanLine = line.replace(bulletPattern, '').trim();
                    if (cleanLine.length > 5) {
                        steps.push(cleanLine);
                        continue;
                    }
                }
            }

            // --- Fallback: if we're in unknown section and line is long, it might be a step ---
            if (currentSection === 'unknown' && line.length > 60) {
                // Long paragraphs after ingredients are likely steps
                if (ingredients.length > 0) {
                    currentSection = 'steps';
                    steps.push(line);
                    continue;
                }
            }
        }

        // --- Post-processing ---

        // If we never found a name, try to use the first non-ingredient, non-step line
        if (!name && lines.length > 0) {
            for (var ni = 0; ni < Math.min(lines.length, 5); ni++) {
                var candidate = lines[ni];
                if (candidate.length > 1 && candidate.length < 120 &&
                    !qtyStartPattern.test(candidate) && !numberedStepPattern.test(candidate) &&
                    !ingredientHeaders.test(candidate) && !stepHeaders.test(candidate)) {
                    name = candidate;
                    break;
                }
            }
        }

        if (!name) name = 'Untitled Recipe';

        // Clean up name — remove trailing colons, hashes, etc.
        name = name.replace(/^#+\s*/, '').replace(/[:\-]+$/, '').trim();

        // If we have no clear sections but have lines that look like ingredients mixed with steps,
        // do a second pass to separate them
        if (ingredients.length === 0 && steps.length === 0 && lines.length > 2) {
            // Try to parse everything as a flat list
            for (var fi = 0; fi < lines.length; fi++) {
                var fLine = lines[fi];
                if (fLine === name) continue;
                if (ingredientHeaders.test(fLine) || stepHeaders.test(fLine) || notesHeaders.test(fLine)) continue;
                if (fLine.match(servingsPattern) && fLine.replace(servingsPattern, '').trim().length < 5) continue;

                var fIng = tryParseIngredientLine(fLine, bulletPattern, fullIngPattern, parenUnitPattern, qtyStartPattern, unicodeFracChars);
                if (fIng) {
                    ingredients.push(fIng);
                } else if (fLine.length > 15) {
                    var cleanStep = fLine.replace(numberedStepPattern, '').replace(bulletPattern, '').trim();
                    if (cleanStep.length > 5) {
                        steps.push(cleanStep);
                    }
                }
            }
        }

        return {
            name: name,
            category: category,
            servings: servings,
            ingredients: ingredients,
            steps: steps
        };
    }

    /**
     * Try to parse a single line as an ingredient.
     * Returns an ingredient object { qty, unit, item, category } or null if not an ingredient.
     */
    function tryParseIngredientLine(line, bulletPattern, fullIngPattern, parenUnitPattern, qtyStartPattern, unicodeFracChars) {
        // Strip leading bullet/dash
        var cleaned = line.replace(bulletPattern, '').trim();
        if (!cleaned) return null;

        // Pattern for "1 (14 oz) can diced tomatoes"
        var parenMatch = cleaned.match(parenUnitPattern);
        if (parenMatch) {
            var qty = normalizeQtyString(parenMatch[1]);
            var parenInfo = parenMatch[2].trim(); // e.g. "14 oz"
            var container = (parenMatch[3] || '').trim();
            var item = parenMatch[4].trim();
            // Combine container + item if container present
            var fullItem = container ? container + ' ' + item : item;
            return {
                qty: qty,
                unit: '(' + parenInfo + ') ' + (container || ''),
                item: item,
                category: guessIngredientCategory(fullItem)
            };
        }

        // Full ingredient pattern: "2 cups flour", "1/2 lb chicken"
        var fullMatch = cleaned.match(fullIngPattern);
        if (fullMatch) {
            var qty = normalizeQtyString(fullMatch[1]);
            var paren = fullMatch[2] ? '(' + fullMatch[2].trim() + ') ' : '';
            var unit = (paren + (fullMatch[3] || '')).trim();
            var item = fullMatch[4].trim();
            return {
                qty: qty,
                unit: unit,
                item: item,
                category: guessIngredientCategory(item)
            };
        }

        // Just a number + item (no unit): "3 large eggs", "2 avocados"
        var numItemPattern = new RegExp('^([\\d\\s\\/\\.\\-' + unicodeFracChars + ']+)\\s+(.+)');
        var numMatch = cleaned.match(numItemPattern);
        if (numMatch) {
            var qtyStr = normalizeQtyString(numMatch[1]).trim();
            var rest = numMatch[2].trim();
            // Only treat as ingredient if qty is reasonable (not too long)
            if (qtyStr.length <= 10 && rest.length > 0 && rest.length < 100) {
                return {
                    qty: qtyStr,
                    unit: '',
                    item: rest,
                    category: guessIngredientCategory(rest)
                };
            }
        }

        // No-quantity items commonly found in ingredients lists:
        // "salt and pepper to taste", "cooking spray", "olive oil"
        var noQtyTerms = /^(salt|pepper|oil|spray|water|ice|garnish|optional|pinch|dash|drizzle|splash)/i;
        var toTaste = /to taste|as needed|for (garnish|serving|drizzling|greasing)/i;
        if (noQtyTerms.test(cleaned) || toTaste.test(cleaned)) {
            return {
                qty: '',
                unit: '',
                item: cleaned,
                category: guessIngredientCategory(cleaned)
            };
        }

        return null;
    }

    /**
     * Check whether AI is configured and available.
     */
    function hasAI() {
        return aiSettings.apiKey && aiSettings.apiKey.length > 0;
    }

    /**
     * Process text input locally (no AI). Returns a Promise for consistency.
     */
    function processTextLocally(text) {
        return new Promise(function(resolve) {
            var recipe = parseRecipeLocally(text);
            resolve(recipe);
        });
    }

    /**
     * Pre-process an image for better OCR results.
     * Converts to grayscale, enhances contrast, and scales up small images.
     * @param {string} dataUrl - The image as a data URL
     * @returns {Promise<string>} The processed image as a data URL
     */
    function preprocessImageForOCR(dataUrl) {
        return new Promise(function(resolve) {
            var img = new Image();
            img.onload = function() {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');

                // Scale up small images (OCR needs ~300 DPI)
                var scale = 1;
                if (img.width < 1500) {
                    scale = 1500 / img.width;
                }
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Grayscale + contrast enhancement
                var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                var data = imageData.data;

                // Convert to grayscale
                for (var i = 0; i < data.length; i += 4) {
                    var gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }

                // Simple contrast stretch
                var min = 255, max = 0;
                for (var j = 0; j < data.length; j += 4) {
                    if (data[j] < min) min = data[j];
                    if (data[j] > max) max = data[j];
                }
                var range = max - min || 1;
                for (var k = 0; k < data.length; k += 4) {
                    var val = Math.round(((data[k] - min) / range) * 255);
                    // Push towards black/white for cleaner text
                    val = val < 128 ? Math.max(0, val - 30) : Math.min(255, val + 30);
                    data[k] = data[k + 1] = data[k + 2] = val;
                }

                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.src = dataUrl;
        });
    }

    /**
     * Clean up raw OCR text by removing noise and fixing common OCR mistakes.
     * @param {string} text - Raw OCR text
     * @returns {string} Cleaned text
     */
    function cleanOCRText(text) {
        var lines = text.split('\n');
        var cleaned = [];

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();

            // Skip empty lines (but keep one between sections)
            if (!line) {
                if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
                    cleaned.push('');
                }
                continue;
            }

            // Skip noise: single characters, just punctuation
            if (line.length <= 2 && !/\d/.test(line)) continue;

            // Fix common OCR mistakes in quantity context
            // "l/2" -> "1/2", "l cup" -> "1 cup"
            line = line.replace(/^l([\/\s])/g, '1$1');
            line = line.replace(/\bl\/(\d)/g, '1/$1');

            // Clean up multiple spaces
            line = line.replace(/\s{2,}/g, ' ');

            // Merge with previous line if it looks like a continuation
            if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
                var prev = cleaned[cleaned.length - 1];
                // If previous line doesn't end with period, colon, or common ending
                // and current line starts with lowercase
                if (!/[.!?:;,]$/.test(prev) && /^[a-z]/.test(line) && prev.length < 60) {
                    cleaned[cleaned.length - 1] = prev + ' ' + line;
                    continue;
                }
            }

            cleaned.push(line);
        }

        return cleaned.join('\n').trim();
    }

    /**
     * Process image files locally using Tesseract.js OCR, then local parsing.
     * Pre-processes images for better quality and cleans up OCR output.
     * Returns a Promise resolving to a recipe object.
     */
    function processImagesLocally(images) {
        if (typeof Tesseract === 'undefined') {
            return Promise.reject(new Error('OCR library (Tesseract.js) is not loaded. Cannot process images without AI.'));
        }

        setStatus('Preparing images for OCR...', 'info');

        // Process ALL images through OCR and concatenate text
        var processNext = function(index, allText) {
            if (index >= images.length) {
                // All images processed
                if (!allText || allText.trim().length < 10) {
                    throw new Error('OCR could not extract enough text from the image(s). Try clearer photos or paste the text manually.');
                }

                var cleanedText = cleanOCRText(allText);

                // Switch to text tab and populate with cleaned OCR output for user review
                switchTab('text');
                var textInput = document.getElementById('loader-text-input');
                if (textInput) {
                    textInput.value = cleanedText;
                }
                setStatus('OCR complete \u2014 review the text above, then click Extract to parse.', 'success');
                updateProcessButton();

                // Don't auto-parse; let user review/edit OCR text first
                return Promise.reject({ _ocrReview: true });
            }

            setStatus('Reading image ' + (index + 1) + ' of ' + images.length + '...', 'processing');

            return preprocessImageForOCR(images[index].dataUrl).then(function(processedImage) {
                return Tesseract.recognize(processedImage, 'eng', {
                    logger: function(m) {
                        if (m.status === 'recognizing text') {
                            var pct = Math.round(m.progress * 100);
                            setStatus('Reading image ' + (index + 1) + ' of ' + images.length + '... ' + pct + '%', 'processing');
                        }
                    }
                });
            }).then(function(result) {
                var text = cleanOCRText(result.data.text);
                return processNext(index + 1, allText + text + '\n\n');
            });
        };

        return processNext(0, '');
    }

    /**
     * Process a PDF file locally — extract text with pdf.js, then parse locally.
     */
    function processPDFLocally(file) {
        setStatus('Extracting text from PDF...', 'info');

        if (typeof pdfjsLib === 'undefined') {
            return Promise.reject(new Error('PDF.js library is not loaded. PDF import is not available.'));
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

        return readFileAsBase64(file).then(function(fileData) {
            var raw = atob(fileData.base64);
            var uint8Array = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) {
                uint8Array[i] = raw.charCodeAt(i);
            }
            return pdfjsLib.getDocument({ data: uint8Array }).promise;
        }).then(function(pdf) {
            var numPages = pdf.numPages;
            var textPromises = [];

            for (var p = 1; p <= numPages; p++) {
                textPromises.push(
                    pdf.getPage(p).then(function(page) {
                        return page.getTextContent();
                    }).then(function(content) {
                        return content.items.map(function(item) { return item.str; }).join(' ');
                    })
                );
            }

            return Promise.all(textPromises);
        }).then(function(pageTexts) {
            var allText = pageTexts.join('\n\n').trim();

            if (allText.length < 20) {
                // Image-based PDF — try OCR if Tesseract is available
                if (typeof Tesseract !== 'undefined') {
                    setStatus('PDF appears image-based. This may not work well without AI. Trying OCR...', 'info');
                    // We can't easily OCR a PDF without rendering pages, which needs canvas
                    // Fall through to parse whatever little text we have
                }
                if (allText.length < 5) {
                    throw new Error('PDF appears to be image-based and could not extract text. Try adding an AI provider in Settings, or paste the recipe text manually.');
                }
            }

            if (allText.length > 15000) {
                allText = allText.substring(0, 15000);
            }

            setStatus('Parsing recipe from PDF text...', 'info');
            return parseRecipeLocally(allText);
        });
    }

    /**
     * Process a URL locally — try JSON-LD first, then extract text and parse locally.
     */
    function processURLLocally(url) {
        setStatus('Fetching URL...', 'info');

        return fetch(CORS_PROXY + encodeURIComponent(url))
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('CORS_FETCH_FAILED');
                }
                return response.text();
            })
            .then(function(html) {
                // Try JSON-LD extraction first (works without AI)
                var jsonLdRecipe = extractJsonLd(html);
                if (jsonLdRecipe) {
                    setStatus('Found structured recipe data!', 'success');
                    return jsonLdRecipe;
                }

                // Fall back to local text parsing
                setStatus('No structured data found. Parsing page text...', 'info');
                var textContent = extractTextFromHTML(html);

                if (!textContent || textContent.length < 20) {
                    throw new Error('Could not extract meaningful text from that URL. Try copying and pasting the recipe text instead.');
                }

                if (textContent.length > 15000) {
                    textContent = textContent.substring(0, 15000);
                }

                return parseRecipeLocally(textContent);
            })
            .catch(function(err) {
                if (err.message === 'CORS_FETCH_FAILED') {
                    throw new Error("Couldn't fetch that URL. Try copying and pasting the recipe text instead.");
                }
                throw err;
            });
    }


    // =========================================================================
    // PDF Processing
    // =========================================================================

    /**
     * Process a PDF file — extract text, fall back to rendering pages as images.
     */
    function processPDF(file) {
        setStatus('Extracting text from PDF...', 'info');

        // Ensure pdf.js worker is configured
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        } else {
            return Promise.reject(new Error('PDF.js library is not loaded. PDF import is not available.'));
        }

        return readFileAsBase64(file).then(function(fileData) {
            // Convert base64 to Uint8Array for pdf.js
            var raw = atob(fileData.base64);
            var uint8Array = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) {
                uint8Array[i] = raw.charCodeAt(i);
            }

            return pdfjsLib.getDocument({ data: uint8Array }).promise;
        }).then(function(pdf) {
            var numPages = pdf.numPages;
            var textPromises = [];

            for (var p = 1; p <= numPages; p++) {
                textPromises.push(
                    pdf.getPage(p).then(function(page) {
                        return page.getTextContent();
                    }).then(function(content) {
                        return content.items.map(function(item) { return item.str; }).join(' ');
                    })
                );
            }

            return Promise.all(textPromises).then(function(pageTexts) {
                var allText = pageTexts.join('\n\n').trim();

                // If text extraction yielded very little, try rendering pages as images
                if (allText.length < 50 && numPages > 0) {
                    setStatus('PDF appears to be image-based. Rendering pages...', 'info');
                    return renderPDFPagesAsImages(pdf, Math.min(numPages, 3));
                }

                // Truncate very long PDFs
                if (allText.length > 15000) {
                    allText = allText.substring(0, 15000);
                }

                setStatus('Sending PDF text to AI...', 'info');
                return callAI(allText, []);
            });
        });
    }

    /**
     * Render up to N pages of a PDF as images and send to AI.
     */
    function renderPDFPagesAsImages(pdf, maxPages) {
        var imagePromises = [];

        for (var p = 1; p <= maxPages; p++) {
            imagePromises.push(
                (function(pageNum) {
                    return pdf.getPage(pageNum).then(function(page) {
                        var scale = 2; // Render at 2x for clarity
                        var viewport = page.getViewport({ scale: scale });
                        var canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        var ctx = canvas.getContext('2d');

                        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
                            var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                            return resizeImage(dataUrl, 1024);
                        });
                    });
                })(p)
            );
        }

        return Promise.all(imagePromises).then(function(images) {
            setStatus('Sending PDF images to AI...', 'info');
            return callAI('', images);
        });
    }


    // =========================================================================
    // UI Helpers
    // =========================================================================

    /**
     * Set the status message area.
     * @param {string} message
     * @param {string} type - 'info', 'error', 'success'
     */
    function setStatus(message, type) {
        var el = document.getElementById('loader-status');
        if (!el) return;

        el.textContent = message;
        if (message) {
            el.className = 'loader-status visible' + (type ? ' ' + type : '');
        } else {
            el.className = 'loader-status';
        }
    }

    /**
     * Switch to a tab in the loader.
     */
    function switchTab(tabName) {
        currentMode = tabName;

        // Update tab buttons
        document.querySelectorAll('.loader-tab').forEach(function(tab) {
            tab.classList.toggle('active', tab.id === 'loader-tab-' + tabName);
        });

        // Update content panels
        document.querySelectorAll('.loader-tab-content').forEach(function(panel) {
            panel.classList.toggle('active', panel.id === 'loader-content-' + tabName);
        });

        updateProcessButton();
    }

    /**
     * Update the process button text based on current input state.
     */
    function updateProcessButton() {
        var btn = document.getElementById('loader-process-btn');
        if (!btn) return;

        var textInput = document.getElementById('loader-text-input');
        var urlInput = document.getElementById('loader-url-input');

        if (currentMode === 'text' && textInput && textInput.value.trim()) {
            btn.textContent = 'Extract from Text';
        } else if (currentMode === 'image' && currentImages.length > 0) {
            var hasPdf = currentImages.some(function(img) {
                return img.mediaType === 'application/pdf';
            });
            if (hasPdf) {
                btn.textContent = 'Extract from PDF';
            } else {
                btn.textContent = 'Extract from ' + currentImages.length + ' Image' + (currentImages.length > 1 ? 's' : '');
            }
        } else if (currentMode === 'url' && urlInput && urlInput.value.trim()) {
            btn.textContent = 'Fetch & Extract';
        } else {
            btn.textContent = '\u2728 Extract Recipe';
        }
    }

    /**
     * Create or update the AI/OCR toggle checkbox near the process button.
     * Only visible when AI is configured.
     */
    function updateAIToggle() {
        var existing = document.getElementById('loader-ai-toggle-wrap');
        var processBtn = document.getElementById('loader-process-btn');
        if (!processBtn) return;

        if (!hasAI()) {
            // No AI configured — remove toggle if present
            if (existing) existing.remove();
            return;
        }

        if (!existing) {
            var toggleDiv = document.createElement('div');
            toggleDiv.id = 'loader-ai-toggle-wrap';
            toggleDiv.className = 'loader-ai-toggle';
            toggleDiv.innerHTML = '<label><input type="checkbox" id="loader-use-ai" checked> Use AI (better accuracy)</label>';
            processBtn.parentNode.insertBefore(toggleDiv, processBtn);
        }

        // Ensure checkbox reflects current preference
        var cb = document.getElementById('loader-use-ai');
        if (cb && aiSettings.preferAI === false) {
            cb.checked = false;
        }
    }

    /**
     * Render image thumbnails in the image preview area.
     */
    function renderImagePreviews() {
        var container = document.getElementById('loader-image-previews');
        if (!container) return;

        if (currentImages.length === 0) {
            container.innerHTML = '<p class="loader-placeholder-text">No images added yet. Drop images here or click the button below.</p>';
            return;
        }

        var html = '';
        currentImages.forEach(function(img, index) {
            html += '<div class="loader-image-thumb" data-index="' + index + '">';
            html += '<img src="' + img.dataUrl + '" alt="Recipe image ' + (index + 1) + '">';
            html += '<button class="remove-image" data-index="' + index + '" title="Remove">&times;</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        // Bind remove buttons
        container.querySelectorAll('.remove-image').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var idx = parseInt(this.dataset.index);
                currentImages.splice(idx, 1);
                renderImagePreviews();
            });
        });

        updateProcessButton();
    }

    /**
     * Render the recipe preview with editable fields.
     * @param {object} recipe - The extracted recipe object
     * @param {boolean} [localParsed=false] - Whether the recipe was parsed locally (no AI)
     */
    function renderPreview(recipe, localParsed) {
        extractedRecipe = recipe;
        var previewEl = document.getElementById('loader-preview');
        if (!previewEl) return;

        var validCategories = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
        var ingCategories = ['produce', 'dairy', 'meat', 'pantry', 'frozen', 'other'];

        var html = '';

        // Show local parsing hint if no AI was used
        if (localParsed) {
            html += '<div class="loader-local-hint">';
            html += '\uD83D\uDCA1 Parsed locally. For better accuracy, add an AI provider in Settings.';
            html += '</div>';
        }

        // Quality warning for poor extraction
        if (recipe.ingredients.length === 0 && recipe.steps.length === 0) {
            html += '<div class="loader-quality-warning">';
            html += '\u26A0\uFE0F This extraction looks incomplete. Try again with clearer input, or edit the fields below.';
            html += '</div>';
        } else if (!recipe.name || recipe.name === 'Untitled Recipe') {
            html += '<div class="loader-quality-warning">';
            html += '\u26A0\uFE0F No recipe name was detected. Please enter a name below.';
            html += '</div>';
        }

        // Name
        html += '<div class="loader-field">';
        html += '<label>Recipe Name</label>';
        html += '<input type="text" id="loader-result-name" class="loader-input" value="' + escapeAttr(recipe.name) + '">';
        html += '</div>';

        // Category
        html += '<div class="loader-field">';
        html += '<label>Category</label>';
        html += '<select id="loader-result-category" class="loader-input">';
        validCategories.forEach(function(cat) {
            var selected = cat === recipe.category ? ' selected' : '';
            html += '<option value="' + cat + '"' + selected + '>' + capitalize(cat) + '</option>';
        });
        html += '</select>';
        html += '</div>';

        // Servings
        html += '<div class="loader-field">';
        html += '<label>Servings</label>';
        html += '<input type="number" id="loader-result-servings" class="loader-input" min="1" max="100" value="' + recipe.servings + '">';
        html += '</div>';

        // Image preview (if we have one from uploaded images)
        if (currentImages.length > 0) {
            html += '<div class="loader-field">';
            html += '<label>Recipe Image</label>';
            html += '<div id="loader-result-image"><img src="' + currentImages[0].dataUrl + '" alt="Recipe" class="loader-preview-img"></div>';
            html += '</div>';
        } else {
            html += '<div id="loader-result-image" style="display:none;"></div>';
        }

        // Ingredients
        html += '<div class="loader-field">';
        html += '<label>Ingredients (' + recipe.ingredients.length + ')</label>';
        html += '<div id="loader-result-ingredients" class="loader-ingredients-list">';
        recipe.ingredients.forEach(function(ing, idx) {
            html += '<div class="loader-ingredient-row" data-index="' + idx + '">';
            html += '<input type="text" class="loader-ing-qty" placeholder="Qty" value="' + escapeAttr(ing.qty) + '">';
            html += '<input type="text" class="loader-ing-unit" placeholder="Unit" value="' + escapeAttr(ing.unit) + '">';
            html += '<input type="text" class="loader-ing-item" placeholder="Item" value="' + escapeAttr(ing.item) + '">';
            html += '<select class="loader-ing-cat">';
            ingCategories.forEach(function(cat) {
                var selected = cat === ing.category ? ' selected' : '';
                html += '<option value="' + cat + '"' + selected + '>' + capitalize(cat) + '</option>';
            });
            html += '</select>';
            html += '<button class="loader-ing-remove" data-index="' + idx + '" title="Remove">&times;</button>';
            html += '</div>';
        });
        html += '</div>';
        html += '<button id="loader-add-ingredient-btn" class="loader-btn-small">+ Add Ingredient</button>';
        html += '</div>';

        // Steps
        html += '<div class="loader-field">';
        html += '<label>Steps (' + recipe.steps.length + ')</label>';
        html += '<div id="loader-result-steps" class="loader-steps-list">';
        recipe.steps.forEach(function(step, idx) {
            html += '<div class="loader-step-row" data-index="' + idx + '">';
            html += '<span class="loader-step-num">' + (idx + 1) + '.</span>';
            html += '<textarea class="loader-step-text" rows="2">' + escapeHtml(step) + '</textarea>';
            html += '<button class="loader-step-remove" data-index="' + idx + '" title="Remove">&times;</button>';
            html += '</div>';
        });
        html += '</div>';
        html += '<button id="loader-add-step-btn" class="loader-btn-small">+ Add Step</button>';
        html += '</div>';

        // Action buttons (Try Again first in DOM, Save on the right for primary action)
        html += '<div class="loader-preview-actions">';
        html += '<button id="loader-retry-btn" class="loader-btn loader-btn-secondary">Try Again</button>';
        html += '<button id="loader-save-btn" class="loader-btn loader-btn-primary">Save Recipe</button>';
        html += '</div>';

        previewEl.innerHTML = html;
        previewEl.style.display = 'block';

        // Hide the input area while showing preview
        var processBtn = document.getElementById('loader-process-btn');
        if (processBtn) processBtn.style.display = 'none';

        // Hide drop zone, tabs, and tab content
        var dropZone = document.getElementById('loader-drop-zone');
        if (dropZone) dropZone.style.display = 'none';
        var tabs = document.querySelector('.loader-tabs');
        if (tabs) tabs.style.display = 'none';
        document.querySelectorAll('.loader-tab-content').forEach(function(el) {
            el.style.display = 'none';
        });

        // Scroll preview into view
        previewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Bind preview action buttons
        bindPreviewActions();
    }

    /**
     * Bind event listeners for the preview area buttons.
     */
    function bindPreviewActions() {
        // Save button
        var saveBtn = document.getElementById('loader-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', handleSave);
        }

        // Retry button
        var retryBtn = document.getElementById('loader-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', handleRetry);
        }

        // Add ingredient button
        var addIngBtn = document.getElementById('loader-add-ingredient-btn');
        if (addIngBtn) {
            addIngBtn.addEventListener('click', function() {
                var list = document.getElementById('loader-result-ingredients');
                if (!list) return;
                var idx = list.querySelectorAll('.loader-ingredient-row').length;
                var ingCategories = ['produce', 'dairy', 'meat', 'pantry', 'frozen', 'other'];
                var html = '<div class="loader-ingredient-row" data-index="' + idx + '">';
                html += '<input type="text" class="loader-ing-qty" placeholder="Qty" value="">';
                html += '<input type="text" class="loader-ing-unit" placeholder="Unit" value="">';
                html += '<input type="text" class="loader-ing-item" placeholder="Item" value="">';
                html += '<select class="loader-ing-cat">';
                ingCategories.forEach(function(cat) {
                    html += '<option value="' + cat + '">' + capitalize(cat) + '</option>';
                });
                html += '</select>';
                html += '<button class="loader-ing-remove" data-index="' + idx + '" title="Remove">&times;</button>';
                html += '</div>';
                list.insertAdjacentHTML('beforeend', html);
                bindRemoveButtons();
            });
        }

        // Add step button
        var addStepBtn = document.getElementById('loader-add-step-btn');
        if (addStepBtn) {
            addStepBtn.addEventListener('click', function() {
                var list = document.getElementById('loader-result-steps');
                if (!list) return;
                var idx = list.querySelectorAll('.loader-step-row').length;
                var html = '<div class="loader-step-row" data-index="' + idx + '">';
                html += '<span class="loader-step-num">' + (idx + 1) + '.</span>';
                html += '<textarea class="loader-step-text" rows="2"></textarea>';
                html += '<button class="loader-step-remove" data-index="' + idx + '" title="Remove">&times;</button>';
                html += '</div>';
                list.insertAdjacentHTML('beforeend', html);
                bindRemoveButtons();
            });
        }

        // Remove buttons for ingredients and steps
        bindRemoveButtons();
    }

    /**
     * Bind remove buttons for dynamically added ingredient/step rows.
     */
    function bindRemoveButtons() {
        document.querySelectorAll('#loader-preview .loader-ing-remove').forEach(function(btn) {
            if (btn._rlBound) return;
            btn.addEventListener('click', function() {
                this.closest('.loader-ingredient-row').remove();
            });
            btn._rlBound = true;
        });

        document.querySelectorAll('#loader-preview .loader-step-remove').forEach(function(btn) {
            if (btn._rlBound) return;
            btn.addEventListener('click', function() {
                this.closest('.loader-step-row').remove();
                // Re-number remaining steps
                document.querySelectorAll('#loader-result-steps .loader-step-row').forEach(function(row, i) {
                    var num = row.querySelector('.loader-step-num');
                    if (num) num.textContent = (i + 1) + '.';
                });
            });
            btn._rlBound = true;
        });
    }

    /**
     * Collect the current values from the preview form.
     */
    function collectPreviewData() {
        var nameEl = document.getElementById('loader-result-name');
        var catEl = document.getElementById('loader-result-category');
        var servEl = document.getElementById('loader-result-servings');

        var name = nameEl ? nameEl.value.trim() : 'Untitled Recipe';
        var category = catEl ? catEl.value : 'dinner';
        var servings = servEl ? parseInt(servEl.value) || 4 : 4;

        // Collect ingredients
        var ingredients = [];
        document.querySelectorAll('#loader-result-ingredients .loader-ingredient-row').forEach(function(row) {
            var qty = row.querySelector('.loader-ing-qty');
            var unit = row.querySelector('.loader-ing-unit');
            var item = row.querySelector('.loader-ing-item');
            var cat = row.querySelector('.loader-ing-cat');

            var itemVal = item ? item.value.trim() : '';
            if (itemVal) {
                ingredients.push({
                    qty: qty ? qty.value.trim() : '',
                    unit: unit ? unit.value.trim() : '',
                    item: itemVal,
                    category: cat ? cat.value : 'other'
                });
            }
        });

        // Collect steps
        var steps = [];
        document.querySelectorAll('#loader-result-steps .loader-step-row').forEach(function(row) {
            var textarea = row.querySelector('.loader-step-text');
            var text = textarea ? textarea.value.trim() : '';
            if (text) {
                steps.push(text);
            }
        });

        // Get image (resize to 800px for storage)
        var image = '';
        if (currentImages.length > 0) {
            image = currentImages[0].dataUrl;
        }

        return {
            name: name,
            category: category,
            servings: servings,
            ingredients: ingredients,
            steps: steps,
            image: image
        };
    }


    // =========================================================================
    // Event Handlers
    // =========================================================================

    /**
     * Handle the main "Extract Recipe" button click.
     * Works with or without AI: uses AI when available, falls back to local parsing.
     */
    function handleProcess() {
        if (isProcessing) return;

        var aiToggle = document.getElementById('loader-use-ai');
        var useAI = hasAI() && (!aiToggle || aiToggle.checked);

        isProcessing = true;
        setStatus('Processing...', 'info');

        // Hide previous preview
        var previewEl = document.getElementById('loader-preview');
        if (previewEl) previewEl.style.display = 'none';

        var promise;
        var parsedLocally = false;

        if (currentMode === 'text') {
            var textInput = document.getElementById('loader-text-input');
            var text = textInput ? textInput.value.trim() : '';
            if (!text) {
                setStatus('Please paste some recipe text first.', 'error');
                isProcessing = false;
                return;
            }

            // Truncate extremely long text
            if (text.length > 15000) {
                text = text.substring(0, 15000);
            }

            if (useAI) {
                setStatus('Sending text to AI...', 'info');
                promise = callAI(text, []);
            } else {
                setStatus('Extracting recipe...', 'info');
                parsedLocally = true;
                promise = processTextLocally(text);
            }

        } else if (currentMode === 'image') {
            if (currentImages.length === 0) {
                setStatus('Please add at least one image first.', 'error');
                isProcessing = false;
                return;
            }

            if (useAI) {
                setStatus('Sending image(s) to AI...', 'info');
                promise = callAI('', currentImages);
            } else {
                parsedLocally = true;
                promise = processImagesLocally(currentImages);
            }

        } else if (currentMode === 'url') {
            var urlInput = document.getElementById('loader-url-input');
            var url = urlInput ? urlInput.value.trim() : '';
            if (!url) {
                setStatus('Please enter a URL first.', 'error');
                isProcessing = false;
                return;
            }

            // Basic URL validation
            if (!url.match(/^https?:\/\/.+/i)) {
                // Try prepending https://
                url = 'https://' + url;
            }

            if (useAI) {
                promise = processURL(url);
            } else {
                parsedLocally = true;
                promise = processURLLocally(url);
            }

        } else {
            setStatus('Unknown input mode.', 'error');
            isProcessing = false;
            return;
        }

        promise.then(function(recipe) {
            isProcessing = false;
            setStatus('Recipe extracted successfully!', 'success');
            renderPreview(recipe, parsedLocally);
        }).catch(function(err) {
            isProcessing = false;

            // Special case: OCR review mode (not an error, user should review text)
            if (err && err._ocrReview) {
                var processBtn = document.getElementById('loader-process-btn');
                if (processBtn) processBtn.style.display = '';
                return;
            }

            var message = err.message || 'An unexpected error occurred.';

            // Improve error messages for common cases
            if (message.indexOf('Failed to fetch') !== -1 || message.indexOf('NetworkError') !== -1) {
                message = 'Network error. Check your connection and try again.';
            }

            setStatus(message, 'error');
            console.error('RecipeLoader error:', err);

            // Re-show process button
            var processBtn = document.getElementById('loader-process-btn');
            if (processBtn) processBtn.style.display = '';

            // Remove any existing error actions before adding new ones
            var existingActions = document.querySelectorAll('.loader-error-actions');
            existingActions.forEach(function(el) { el.remove(); });

            // Show error action buttons
            var statusEl = document.getElementById('loader-status');
            if (statusEl) {
                var errorActions = document.createElement('div');
                errorActions.className = 'loader-error-actions';
                errorActions.innerHTML = '<button class="loader-btn loader-btn-secondary loader-error-retry">Try Again</button>' +
                    '<button class="loader-btn loader-btn-secondary loader-error-manual">Enter Manually</button>';
                statusEl.parentNode.insertBefore(errorActions, statusEl.nextSibling);

                errorActions.querySelector('.loader-error-retry').addEventListener('click', function() {
                    setStatus('', '');
                    errorActions.remove();
                });
                errorActions.querySelector('.loader-error-manual').addEventListener('click', function() {
                    hide();
                    if (window.MealPlannerAPI) window.MealPlannerAPI.showModal('recipe-modal');
                });
            }
        });
    }

    /**
     * Handle save button — collect preview data and create recipe.
     */
    function handleSave() {
        var data = collectPreviewData();

        if (!data.name) {
            setStatus('Please enter a recipe name.', 'error');
            return;
        }

        if (data.ingredients.length === 0) {
            setStatus('Please add at least one ingredient.', 'error');
            return;
        }

        // Resize image for storage (800px max)
        var saveRecipe = function(imageStr) {
            data.image = imageStr;

            if (window.MealPlannerAPI && typeof window.MealPlannerAPI.createRecipe === 'function') {
                window.MealPlannerAPI.createRecipe(data);

                if (typeof window.MealPlannerAPI.renderRecipeGrid === 'function') {
                    window.MealPlannerAPI.renderRecipeGrid();
                }
            } else {
                console.warn('RecipeLoader: MealPlannerAPI.createRecipe not available');
            }

            hide(true);
            setStatus('', '');
        };

        if (data.image && data.image.length > 0) {
            resizeImage(data.image, 800).then(function(resized) {
                saveRecipe(resized.dataUrl);
            }).catch(function() {
                // If resize fails, save with original
                saveRecipe(data.image);
            });
        } else {
            saveRecipe('');
        }
    }

    /**
     * Handle retry — reset preview and allow re-processing.
     */
    function handleRetry() {
        var previewEl = document.getElementById('loader-preview');
        if (previewEl) {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
        }

        var processBtn = document.getElementById('loader-process-btn');
        if (processBtn) processBtn.style.display = '';

        // Show drop zone, tabs, and active tab content back
        var dropZone = document.getElementById('loader-drop-zone');
        if (dropZone) dropZone.style.display = '';
        var tabs = document.querySelector('.loader-tabs');
        if (tabs) tabs.style.display = '';
        document.querySelectorAll('.loader-tab-content').forEach(function(el) {
            el.style.display = '';
        });
        // Re-apply tab visibility
        switchTab(currentMode);

        // Scroll back to top of modal
        var modal = document.getElementById('recipe-loader-modal');
        if (modal) {
            var modalContent = modal.querySelector('.modal-body') || modal;
            modalContent.scrollTop = 0;
        }

        setStatus('', '');
        extractedRecipe = null;
    }

    /**
     * Handle image file selection from the file input.
     */
    function handleFileSelect(files) {
        if (!files || files.length === 0) return;

        var fileArray = Array.prototype.slice.call(files);
        var imageFiles = [];
        var pdfFiles = [];

        fileArray.forEach(function(file) {
            if (file.type.indexOf('image/') === 0) {
                imageFiles.push(file);
            } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                pdfFiles.push(file);
            }
        });

        // Handle PDF files (process the first one)
        if (pdfFiles.length > 0) {
            handleProcess_PDF(pdfFiles[0]);
            return;
        }

        // Handle image files
        if (imageFiles.length > 0) {
            switchTab('image');
            setStatus('Loading images...', 'info');

            var promises = imageFiles.map(function(file) {
                return readFileAsBase64(file).then(function(data) {
                    return resizeImage(data.dataUrl, 1024);
                });
            });

            Promise.all(promises).then(function(images) {
                images.forEach(function(img) {
                    currentImages.push(img);
                });
                renderImagePreviews();
                setStatus(currentImages.length + ' image(s) ready. Click Extract to process.', 'success');
                updateAIToggle();
            }).catch(function(err) {
                setStatus('Error loading images: ' + err.message, 'error');
            });
        }
    }

    /**
     * Handle a PDF file — separate flow from image processing.
     * Works with or without AI.
     */
    function handleProcess_PDF(file) {
        if (isProcessing) return;

        isProcessing = true;
        var parsedLocally = !hasAI();

        // Hide previous preview
        var previewEl = document.getElementById('loader-preview');
        if (previewEl) previewEl.style.display = 'none';

        var promise;
        if (hasAI()) {
            promise = processPDF(file);
        } else {
            promise = processPDFLocally(file);
        }

        promise.then(function(recipe) {
            isProcessing = false;
            setStatus('Recipe extracted from PDF!', 'success');
            renderPreview(recipe, parsedLocally);
        }).catch(function(err) {
            isProcessing = false;
            var message = err.message || 'Failed to process PDF.';
            setStatus(message, 'error');
            console.error('RecipeLoader PDF error:', err);
        });
    }

    /**
     * Handle URL fetch button click.
     */
    function handleFetchURL() {
        // Clicking "Fetch URL" is the same as processing in URL mode
        currentMode = 'url';
        handleProcess();
    }


    // =========================================================================
    // Drag & Drop
    // =========================================================================

    function setupDragDrop() {
        var dropZone = document.getElementById('loader-drop-zone');
        if (!dropZone) return;

        // Prevent defaults for all drag events on the drop zone
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
            dropZone.addEventListener(eventName, function(e) {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Highlight on drag over
        ['dragenter', 'dragover'].forEach(function(eventName) {
            dropZone.addEventListener(eventName, function() {
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(function(eventName) {
            dropZone.addEventListener(eventName, function() {
                dropZone.classList.remove('drag-over');
            });
        });

        // Handle drop
        dropZone.addEventListener('drop', function(e) {
            var dt = e.dataTransfer;

            // Check for files
            if (dt.files && dt.files.length > 0) {
                handleFileSelect(dt.files);
                return;
            }

            // Check for text data
            var textData = dt.getData('text/plain') || dt.getData('text');
            if (textData) {
                // Check if it looks like a URL
                if (textData.match(/^https?:\/\//i)) {
                    switchTab('url');
                    var urlInput = document.getElementById('loader-url-input');
                    if (urlInput) {
                        urlInput.value = textData;
                    }
                    setStatus('URL dropped. Click "Extract Recipe" to process.', 'info');
                } else {
                    // Treat as text
                    switchTab('text');
                    var textInput = document.getElementById('loader-text-input');
                    if (textInput) {
                        textInput.value = textData;
                    }
                    setStatus('Text dropped. Click "Extract Recipe" to process.', 'info');
                }
            }
        });
    }


    // =========================================================================
    // Modal Show / Hide / Reset
    // =========================================================================

    function show() {
        loadAISettings();
        setupSettingsBindings();
        resetLoader();

        // Show or remove AI setup banner
        var existingBanner = document.querySelector('.loader-ai-banner');
        if (existingBanner) existingBanner.remove();

        if (!hasAI()) {
            var modalBody = document.querySelector('#recipe-loader-modal .modal-body') ||
                            document.getElementById('loader-drop-zone');
            if (modalBody) {
                var banner = document.createElement('div');
                banner.className = 'loader-ai-banner';
                banner.innerHTML = '<span>No AI configured \u2014 using local pattern matching.</span>' +
                    '<button class="loader-ai-banner-link">Set up AI \u2192</button>';
                banner.querySelector('.loader-ai-banner-link').addEventListener('click', function() {
                    hide();
                    if (window.MealPlannerAPI) window.MealPlannerAPI.showModal('settings-modal');
                });
                var dropZone = document.getElementById('loader-drop-zone');
                if (dropZone && dropZone.parentNode) {
                    dropZone.parentNode.insertBefore(banner, dropZone);
                } else {
                    modalBody.insertBefore(banner, modalBody.firstChild);
                }
            }
        }

        if (window.MealPlannerAPI && typeof window.MealPlannerAPI.showModal === 'function') {
            window.MealPlannerAPI.showModal('recipe-loader-modal');
        } else {
            // Fallback: toggle class directly
            var modal = document.getElementById('recipe-loader-modal');
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        }
    }

    /**
     * Check if the loader has unsaved work that would be lost on close.
     */
    function hasUnsavedWork() {
        var textInput = document.getElementById('loader-text-input');
        if (textInput && textInput.value.trim()) return true;

        if (currentImages.length > 0) return true;

        var urlInput = document.getElementById('loader-url-input');
        if (urlInput && urlInput.value.trim()) return true;

        var previewEl = document.getElementById('loader-preview');
        if (previewEl && previewEl.style.display !== 'none' && previewEl.style.display !== '') return true;

        return false;
    }

    /**
     * Show an in-app confirmation dialog inside the recipe-loader modal.
     * Replaces native confirm() for better UX.
     */
    function showInAppConfirm(message, onYes, onNo) {
        // Remove any existing confirm overlay
        var existing = document.querySelector('.loader-confirm-overlay');
        if (existing) existing.remove();

        var confirmDiv = document.createElement('div');
        confirmDiv.className = 'loader-confirm-overlay';
        confirmDiv.innerHTML =
            '<div class="loader-confirm-box">' +
                '<p>' + message + '</p>' +
                '<div class="loader-confirm-actions">' +
                    '<button class="loader-btn loader-btn-secondary" data-action="no">Keep Editing</button>' +
                    '<button class="loader-btn loader-btn-primary" data-action="yes">Discard</button>' +
                '</div>' +
            '</div>';

        var modal = document.getElementById('recipe-loader-modal');
        if (modal) {
            modal.appendChild(confirmDiv);
        } else {
            document.body.appendChild(confirmDiv);
        }

        confirmDiv.querySelector('[data-action="yes"]').addEventListener('click', function() {
            confirmDiv.remove();
            if (onYes) onYes();
        });
        confirmDiv.querySelector('[data-action="no"]').addEventListener('click', function() {
            confirmDiv.remove();
            if (onNo) onNo();
        });
    }

    function hide(skipConfirm) {
        if (!skipConfirm && hasUnsavedWork()) {
            showInAppConfirm('Discard unsaved recipe import?', function() {
                doHide();
            });
            return;
        }
        doHide();
    }

    function doHide() {
        if (window.MealPlannerAPI && typeof window.MealPlannerAPI.hideModal === 'function') {
            window.MealPlannerAPI.hideModal('recipe-loader-modal');
        } else {
            var modal = document.getElementById('recipe-loader-modal');
            if (modal) {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        resetLoader();
    }

    /**
     * Reset the loader to its initial state.
     */
    function resetLoader() {
        currentImages = [];
        currentMode = 'text';
        isProcessing = false;
        extractedRecipe = null;

        // Reset text input
        var textInput = document.getElementById('loader-text-input');
        if (textInput) textInput.value = '';

        // Reset URL input
        var urlInput = document.getElementById('loader-url-input');
        if (urlInput) urlInput.value = '';

        // Reset file input
        var fileInput = document.getElementById('loader-file-input');
        if (fileInput) fileInput.value = '';

        // Reset image previews
        renderImagePreviews();

        // Reset preview
        var previewEl = document.getElementById('loader-preview');
        if (previewEl) {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
        }

        // Reset status
        setStatus('', '');

        // Show process button
        var processBtn = document.getElementById('loader-process-btn');
        if (processBtn) processBtn.style.display = '';

        // Remove AI toggle
        var aiToggle = document.getElementById('loader-ai-toggle-wrap');
        if (aiToggle) aiToggle.remove();

        // Reset to text tab
        switchTab('text');
    }


    // =========================================================================
    // Initialization
    // =========================================================================

    function init() {
        loadAISettings();

        // Wait for DOM to be ready
        var setup = function() {
            // Tab switching
            document.querySelectorAll('.loader-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var tabName = this.id.replace('loader-tab-', '');
                    switchTab(tabName);
                });
            });

            // File input trigger button
            var addImagesBtn = document.getElementById('loader-add-images-btn');
            var fileInput = document.getElementById('loader-file-input');
            if (addImagesBtn && fileInput) {
                addImagesBtn.addEventListener('click', function() {
                    fileInput.click();
                });
            }

            // File input change
            if (fileInput) {
                fileInput.addEventListener('change', function() {
                    handleFileSelect(this.files);
                    // Reset so same file can be selected again
                    this.value = '';
                });
            }

            // Process button
            var processBtn = document.getElementById('loader-process-btn');
            if (processBtn) {
                processBtn.addEventListener('click', handleProcess);
            }

            // Enter key on URL input triggers extraction
            var urlInput = document.getElementById('loader-url-input');
            if (urlInput) {
                urlInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleProcess();
                    }
                });
                urlInput.addEventListener('input', updateProcessButton);
            }

            // Update process button text when text input changes
            var textInput = document.getElementById('loader-text-input');
            if (textInput) {
                textInput.addEventListener('input', updateProcessButton);
            }

            // Close button — stopImmediatePropagation to prevent app.js's generic .modal-close handler
            var closeBtn = document.getElementById('loader-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', function(e) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    hide();
                });
            }

            // Click outside modal to close — stopImmediatePropagation to prevent app.js's generic handler
            var modalOverlay = document.getElementById('recipe-loader-modal');
            if (modalOverlay) {
                modalOverlay.addEventListener('click', function(e) {
                    if (e.target === modalOverlay) {
                        e.stopImmediatePropagation();
                        hide();
                    }
                });
            }

            // Make drop zone clickable to trigger file input
            var dropZone = document.getElementById('loader-drop-zone');
            if (dropZone) {
                dropZone.addEventListener('click', function(e) {
                    // Don't trigger if clicking on a button or input inside the drop zone
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                    var fileInput = document.getElementById('loader-file-input');
                    if (fileInput) fileInput.click();
                });
            }

            // Escape key to close modal
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    var modal = document.getElementById('recipe-loader-modal');
                    if (modal && modal.classList.contains('active')) {
                        hide();
                    }
                }
            });

            // Setup drag and drop
            setupDragDrop();

            // Setup settings bindings
            setupSettingsBindings();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }


    // =========================================================================
    // Utility Functions
    // =========================================================================

    function escapeAttr(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }


    // =========================================================================
    // Public API
    // =========================================================================

    window.RecipeLoader = {
        init: init,
        show: show,
        hide: hide
    };

})();
