(function() {
    'use strict';

    const STATE = {
        recipes: [],
        plans: [],
        settings: {
            weekLength: 7,
            weekStartDate: getTodayString()
        },
        shoppingChecked: [],
        currentRecipeId: null,
        currentPlanDate: null,
        cookitStepChecked: []
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showAppConfirm(message, onConfirm, onCancel, confirmText, cancelText) {
        const modal = document.getElementById('app-confirm-modal');
        const msgEl = document.getElementById('app-confirm-message');
        const actionsEl = document.getElementById('app-confirm-actions');

        msgEl.textContent = message;
        actionsEl.innerHTML = '';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = cancelText || 'Cancel';
        cancelBtn.addEventListener('click', function() {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            if (onCancel) onCancel();
        });

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = confirmText || 'OK';
        confirmBtn.addEventListener('click', function() {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            if (onConfirm) onConfirm();
        });

        actionsEl.appendChild(cancelBtn);
        actionsEl.appendChild(confirmBtn);

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function showAppAlert(message, onOk) {
        const modal = document.getElementById('app-confirm-modal');
        const msgEl = document.getElementById('app-confirm-message');
        const actionsEl = document.getElementById('app-confirm-actions');

        msgEl.textContent = message;
        actionsEl.innerHTML = '';

        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-primary';
        okBtn.textContent = 'OK';
        okBtn.addEventListener('click', function() {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            if (onOk) onOk();
        });

        actionsEl.appendChild(okBtn);

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function getTodayString() {
        const today = new Date();
        return today.toISOString().split('T')[0];
    }

    function formatDate(dateString) {
        const date = new Date(dateString + 'T00:00:00');
        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function formatDayName(dateString) {
        const date = new Date(dateString + 'T00:00:00');
        const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
        const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return { weekday, monthDay };
    }

    function addDays(dateString, days) {
        const date = new Date(dateString + 'T00:00:00');
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    }

    function loadRecipes() {
        const data = localStorage.getItem('mp_recipes');
        STATE.recipes = data ? JSON.parse(data) : [];
    }

    function saveRecipes() {
        localStorage.setItem('mp_recipes', JSON.stringify(STATE.recipes));
        if (window.CloudSync) CloudSync.debouncedSync('recipes', STATE.recipes);
    }

    function loadPlans() {
        const data = localStorage.getItem('mp_plans');
        const plans = data ? JSON.parse(data) : [];
        STATE.plans = plans.map(p => {
            if (p.meal && !p.hasOwnProperty('recipeId')) {
                return p;
            }
            if (p.meal) {
                delete p.meal;
            }
            return p;
        });
    }

    function savePlans() {
        localStorage.setItem('mp_plans', JSON.stringify(STATE.plans));
        if (window.CloudSync) CloudSync.debouncedSync('plans', STATE.plans);
    }

    function loadSettings() {
        const data = localStorage.getItem('mp_settings');
        if (data) {
            STATE.settings = JSON.parse(data);
        }
    }

    function saveSettings() {
        localStorage.setItem('mp_settings', JSON.stringify(STATE.settings));
        if (window.CloudSync) CloudSync.debouncedSync('settings', STATE.settings);
    }

    function loadShoppingChecked() {
        const data = localStorage.getItem('mp_shopping_checked');
        STATE.shoppingChecked = data ? JSON.parse(data) : [];
    }

    function saveShoppingChecked() {
        localStorage.setItem('mp_shopping_checked', JSON.stringify(STATE.shoppingChecked));
        if (window.CloudSync) CloudSync.debouncedSync('shopping_checked', STATE.shoppingChecked);
    }

    function loadAllData() {
        loadRecipes();
        loadPlans();
        loadSettings();
        loadShoppingChecked();
    }

    function exportData() {
        const data = {
            recipes: STATE.recipes,
            plans: STATE.plans,
            settings: STATE.settings,
            shoppingChecked: STATE.shoppingChecked,
            exportDate: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meal-planner-backup-${getTodayString()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importData(jsonData) {
        try {
            const data = JSON.parse(jsonData);

            showAppConfirm('This will replace all current data. Are you sure?', function() {
                STATE.recipes = data.recipes || [];
                STATE.plans = data.plans || [];
                STATE.settings = data.settings || { weekLength: 7, weekStartDate: getTodayString() };
                STATE.shoppingChecked = data.shoppingChecked || [];

                saveRecipes();
                savePlans();
                saveSettings();
                saveShoppingChecked();

                showAppAlert('Data imported successfully!');
                renderRecipeGrid();
                renderPlannerGrid();
                renderShoppingList();
                updateSettingsForm();
            }, null, 'Replace', 'Cancel');
        } catch (error) {
            showAppAlert('Failed to import data. Invalid JSON file.');
            console.error(error);
        }
    }

    function clearAllData() {
        showAppConfirm('This will delete ALL your recipes, plans, and settings. Are you sure?', function() {
            showAppConfirm('This action cannot be undone. Really delete everything?', function() {
                localStorage.removeItem('mp_recipes');
                localStorage.removeItem('mp_plans');
                localStorage.removeItem('mp_settings');
                localStorage.removeItem('mp_shopping_checked');

                STATE.recipes = [];
                STATE.plans = [];
                STATE.settings = { weekLength: 7, weekStartDate: getTodayString() };
                STATE.shoppingChecked = [];

                renderRecipeGrid();
                renderPlannerGrid();
                renderShoppingList();
                updateSettingsForm();

                showAppAlert('All data cleared.');
            }, null, 'Delete Everything', 'Go Back');
        }, null, 'Continue', 'Cancel');
    }

    function switchView(viewId) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.add('active');
        }

        const targetBtn = document.querySelector(`[data-view="${viewId}"]`);
        if (targetBtn) {
            targetBtn.classList.add('active');
        }

        if (viewId === 'planner-view') {
            renderPlannerGrid();
        } else if (viewId === 'shopping-view') {
            renderShoppingList();
        } else if (viewId === 'cookplan-view') {
            renderCookPlan();
        } else if (viewId === 'cookit-view') {
            renderCookItView();
        }
    }

    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    function hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    function getRecipeById(id) {
        return STATE.recipes.find(r => r.id === id);
    }

    function createRecipe(recipeData) {
        const recipe = {
            id: generateUUID(),
            name: recipeData.name,
            category: recipeData.category,
            servings: recipeData.servings,
            ingredients: recipeData.ingredients,
            steps: recipeData.steps,
            image: recipeData.image || '',
            createdAt: new Date().toISOString()
        };

        STATE.recipes.push(recipe);
        saveRecipes();
        return recipe;
    }

    function updateRecipe(id, recipeData) {
        const index = STATE.recipes.findIndex(r => r.id === id);
        if (index !== -1) {
            STATE.recipes[index] = {
                ...STATE.recipes[index],
                name: recipeData.name,
                category: recipeData.category,
                servings: recipeData.servings,
                ingredients: recipeData.ingredients,
                steps: recipeData.steps,
                image: recipeData.image
            };
            saveRecipes();
            return STATE.recipes[index];
        }
        return null;
    }

    function deleteRecipe(id) {
        STATE.recipes = STATE.recipes.filter(r => r.id !== id);
        STATE.plans = STATE.plans.filter(p => p.recipeId !== id);
        saveRecipes();
        savePlans();
    }

    function filterRecipes(searchTerm, category) {
        let filtered = STATE.recipes;

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(r => r.name.toLowerCase().includes(term));
        }

        if (category) {
            filtered = filtered.filter(r => r.category === category);
        }

        return filtered;
    }

    function renderRecipeGrid() {
        const grid = document.getElementById('recipes-grid');
        const searchTerm = document.getElementById('recipe-search').value;
        const category = document.getElementById('recipe-filter').value;
        const recipes = filterRecipes(searchTerm, category);

        if (recipes.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2m0 0h4v7a2 2 0 002 2h4a2 2 0 002-2V2M3 16h18v2a4 4 0 01-4 4H7a4 4 0 01-4-4v-2z"></path>
                    </svg>
                    <p>No recipes yet. Click the + button to add one!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = recipes.map(recipe => {
            const imageSrc = recipe.image || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect fill="#21262d" width="400" height="300"/><text x="200" y="150" fill="#8b949e" font-size="48" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">\u{1F372}</text></svg>');

            return `
                <div class="recipe-card" data-recipe-id="${recipe.id}">
                    <img src="${imageSrc}" alt="${escapeHtml(recipe.name)}" class="recipe-card-image">
                    <div class="recipe-card-body">
                        <div class="recipe-card-name">${escapeHtml(recipe.name)}</div>
                        <span class="recipe-card-category">${escapeHtml(recipe.category)}</span>
                    </div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.recipe-card').forEach(card => {
            card.addEventListener('click', () => {
                showRecipeDetail(card.dataset.recipeId);
            });
        });
    }

    function showRecipeDetail(recipeId) {
        const recipe = getRecipeById(recipeId);
        if (!recipe) return;

        STATE.currentRecipeId = recipeId;

        const modal = document.getElementById('recipe-detail-modal');
        document.getElementById('detail-recipe-name').textContent = recipe.name;

        const content = document.getElementById('recipe-detail-content');

        let html = '';

        if (recipe.image) {
            html += `<img src="${recipe.image}" alt="${escapeHtml(recipe.name)}" class="recipe-detail-image">`;
        }

        html += `
            <div class="recipe-detail-meta">
                <div class="recipe-detail-meta-item">
                    <strong>Category:</strong> <span style="text-transform: capitalize">${escapeHtml(recipe.category)}</span>
                </div>
                <div class="recipe-detail-meta-item">
                    <strong>Servings:</strong> ${escapeHtml(String(recipe.servings))}
                </div>
            </div>
        `;

        if (recipe.ingredients && recipe.ingredients.length > 0) {
            html += `
                <div class="recipe-detail-section">
                    <h3>Ingredients</h3>
                    <ul>
                        ${recipe.ingredients.map(ing => `
                            <li>${ing.qty} ${ing.unit} ${ing.item}</li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        if (recipe.steps && recipe.steps.length > 0) {
            html += `
                <div class="recipe-detail-section">
                    <h3>Instructions</h3>
                    <ol>
                        ${recipe.steps.map(step => `<li>${step}</li>`).join('')}
                    </ol>
                </div>
            `;
        }

        content.innerHTML = html;
        showModal('recipe-detail-modal');
    }

    function openRecipeForm(recipeId = null) {
        STATE.currentRecipeId = recipeId;

        const form = document.getElementById('recipe-form');
        const title = document.getElementById('recipe-modal-title');

        if (recipeId) {
            const recipe = getRecipeById(recipeId);
            if (!recipe) return;

            title.textContent = 'Edit Recipe';
            document.getElementById('recipe-id').value = recipe.id;
            document.getElementById('recipe-name').value = recipe.name;
            document.getElementById('recipe-category').value = recipe.category;
            document.getElementById('recipe-servings').value = recipe.servings;

            if (recipe.image) {
                const preview = document.getElementById('image-preview');
                preview.innerHTML = `<img src="${recipe.image}" alt="Preview">`;
            }

            renderIngredients(recipe.ingredients);
            renderSteps(recipe.steps);
        } else {
            title.textContent = 'Add Recipe';
            form.reset();
            document.getElementById('recipe-id').value = '';
            document.getElementById('image-preview').innerHTML = '';
            renderIngredients([{ qty: '', unit: '', item: '', category: 'produce' }]);
            renderSteps(['']);
        }

        document.getElementById('ocr-section').style.display = 'none';
        document.getElementById('ocr-text').value = '';

        showModal('recipe-modal');
    }

    function renderIngredients(ingredients) {
        const container = document.getElementById('ingredients-list');
        container.innerHTML = ingredients.map((ing, index) => `
            <div class="ingredient-row" data-index="${index}">
                <input type="text" class="ingredient-qty" placeholder="e.g., 2" value="${ing.qty || ''}" data-field="qty" aria-label="Quantity">
                <input type="text" class="ingredient-unit" placeholder="e.g., cups" value="${ing.unit || ''}" data-field="unit" aria-label="Unit">
                <input type="text" class="ingredient-item" placeholder="e.g., chicken breast" value="${ing.item || ''}" data-field="item" required aria-label="Ingredient name">
                <select class="ingredient-category" data-field="category" aria-label="Category">
                    <option value="produce" ${ing.category === 'produce' ? 'selected' : ''}>Produce</option>
                    <option value="dairy" ${ing.category === 'dairy' ? 'selected' : ''}>Dairy</option>
                    <option value="meat" ${ing.category === 'meat' ? 'selected' : ''}>Meat</option>
                    <option value="pantry" ${ing.category === 'pantry' ? 'selected' : ''}>Pantry</option>
                    <option value="frozen" ${ing.category === 'frozen' ? 'selected' : ''}>Frozen</option>
                    <option value="other" ${ing.category === 'other' ? 'selected' : ''}>Other</option>
                </select>
                <button type="button" class="remove-btn remove-ingredient" data-index="${index}" aria-label="Remove ingredient">&times;</button>
            </div>
        `).join('');

        container.querySelectorAll('.remove-ingredient').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const currentIngredients = collectIngredients();
                currentIngredients.splice(index, 1);
                renderIngredients(currentIngredients);
            });
        });
    }

    function renderSteps(steps) {
        const container = document.getElementById('steps-list');
        container.innerHTML = steps.map((step, index) => `
            <div class="step-row" data-index="${index}">
                <div class="step-number">${index + 1}</div>
                <div class="step-text">
                    <textarea placeholder="e.g., Preheat oven to 375°F" required aria-label="Step ${index + 1}">${step || ''}</textarea>
                </div>
                <div class="step-controls">
                    <button type="button" class="move-btn move-step-up" data-index="${index}" aria-label="Move step up" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="move-btn move-step-down" data-index="${index}" aria-label="Move step down" ${index === steps.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="remove-btn remove-step" data-index="${index}" aria-label="Remove step">&times;</button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.remove-step').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const currentSteps = collectSteps();
                currentSteps.splice(index, 1);
                renderSteps(currentSteps);
            });
        });

        container.querySelectorAll('.move-step-up').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                if (index === 0) return;
                const currentSteps = collectSteps();
                [currentSteps[index - 1], currentSteps[index]] = [currentSteps[index], currentSteps[index - 1]];
                renderSteps(currentSteps);
            });
        });

        container.querySelectorAll('.move-step-down').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const currentSteps = collectSteps();
                if (index === currentSteps.length - 1) return;
                [currentSteps[index], currentSteps[index + 1]] = [currentSteps[index + 1], currentSteps[index]];
                renderSteps(currentSteps);
            });
        });
    }

    function collectIngredients() {
        const rows = document.querySelectorAll('.ingredient-row');
        const ingredients = [];

        rows.forEach(row => {
            const qty = row.querySelector('[data-field="qty"]').value.trim();
            const unit = row.querySelector('[data-field="unit"]').value.trim();
            const item = row.querySelector('[data-field="item"]').value.trim();
            const category = row.querySelector('[data-field="category"]').value;

            if (item) {
                ingredients.push({ qty, unit, item, category });
            }
        });

        return ingredients;
    }

    function collectSteps() {
        const rows = document.querySelectorAll('.step-row');
        const steps = [];

        rows.forEach(row => {
            const step = row.querySelector('textarea').value.trim();
            if (step) {
                steps.push(step);
            }
        });

        return steps;
    }

    function handleRecipeSubmit(e) {
        e.preventDefault();

        const recipeId = document.getElementById('recipe-id').value;
        const name = document.getElementById('recipe-name').value.trim();
        const category = document.getElementById('recipe-category').value;
        const servings = parseInt(document.getElementById('recipe-servings').value);
        const ingredients = collectIngredients();
        const steps = collectSteps();

        if (!name) {
            showAppAlert('Please enter a recipe name.');
            return;
        }

        if (ingredients.length === 0) {
            showAppAlert('Please add at least one ingredient.');
            return;
        }

        if (steps.length === 0) {
            showAppAlert('Please add at least one step.');
            return;
        }

        const imagePreview = document.querySelector('#image-preview img');
        const image = imagePreview ? imagePreview.src : '';

        const recipeData = {
            name,
            category,
            servings,
            ingredients,
            steps,
            image
        };

        if (recipeId) {
            updateRecipe(recipeId, recipeData);
        } else {
            createRecipe(recipeData);
        }

        hideModal('recipe-modal');
        renderRecipeGrid();
    }

    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            const preview = document.getElementById('image-preview');
            preview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
    }

    function handleOCRScan() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const spinner = document.getElementById('loading-spinner');
            spinner.style.display = 'flex';

            try {
                const result = await Tesseract.recognize(file, 'eng', {
                    logger: m => console.log(m)
                });

                document.getElementById('ocr-text').value = result.data.text;
                document.getElementById('ocr-section').style.display = 'block';
            } catch (error) {
                showAppAlert('Failed to read image. Please try again.');
                console.error(error);
            } finally {
                spinner.style.display = 'none';
            }
        });

        input.click();
    }

    function parseOCRText() {
        const text = document.getElementById('ocr-text').value;
        if (!text) return;

        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        let name = '';
        const ingredients = [];
        const steps = [];

        const qtyPattern = /^[\d\/\.\s]+(cup|cups|tbsp|tsp|lb|lbs|oz|g|kg|ml|l|pound|pounds|ounce|ounces|tablespoon|tablespoons|teaspoon|teaspoons|gram|grams|kilogram|liter|milliliter)/i;
        const numberPattern = /^\d+[\.\)]/;

        let currentSection = 'name';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (i === 0 && !qtyPattern.test(line) && !numberPattern.test(line)) {
                name = line;
                continue;
            }

            if (/ingredient/i.test(line) || /what you.*need/i.test(line)) {
                currentSection = 'ingredients';
                continue;
            }

            if (/instruction/i.test(line) || /direction/i.test(line) || /step/i.test(line) || /method/i.test(line)) {
                currentSection = 'steps';
                continue;
            }

            if (qtyPattern.test(line)) {
                const parts = line.split(/\s+/);
                let qty = parts[0];
                let unit = '';
                let item = '';

                if (parts.length > 1 && /^(cup|cups|tbsp|tsp|lb|lbs|oz|g|kg|ml|l)/i.test(parts[1])) {
                    unit = parts[1];
                    item = parts.slice(2).join(' ');
                } else {
                    item = parts.slice(1).join(' ');
                }

                ingredients.push({
                    qty: qty,
                    unit: unit,
                    item: item || line,
                    category: 'other'
                });
            } else if (numberPattern.test(line)) {
                steps.push(line.replace(/^\d+[\.\)]\s*/, ''));
            } else {
                if (currentSection === 'ingredients' && line.length > 0) {
                    ingredients.push({
                        qty: '',
                        unit: '',
                        item: line,
                        category: 'other'
                    });
                } else if (currentSection === 'steps' && line.length > 0) {
                    steps.push(line);
                }
            }
        }

        if (name) {
            document.getElementById('recipe-name').value = name;
        }

        if (ingredients.length > 0) {
            renderIngredients(ingredients);
        }

        if (steps.length > 0) {
            renderSteps(steps);
        }

        document.getElementById('ocr-section').style.display = 'none';
    }

    function getPlannerDateRange() {
        const startDate = document.getElementById('planner-start-date').value || getTodayString();
        const duration = parseInt(document.getElementById('planner-duration').value) || 7;

        const dates = [];
        for (let i = 0; i < duration; i++) {
            dates.push(addDays(startDate, i));
        }

        return dates;
    }

    function getPlansForDate(date) {
        return STATE.plans.filter(p => p.date === date);
    }

    function addPlan(date, recipeId) {
        STATE.plans.push({
            id: generateUUID(),
            date,
            recipeId
        });
        savePlans();
    }

    function removePlan(planId) {
        STATE.plans = STATE.plans.filter(p => p.id !== planId);
        savePlans();
    }

    function renderPlannerGrid() {
        const container = document.getElementById('planner-grid');
        const dates = getPlannerDateRange();

        let html = '';

        dates.forEach(date => {
            const { weekday, monthDay } = formatDayName(date);
            const plans = getPlansForDate(date);

            html += `
                <div class="day-card">
                    <div class="day-card-header">
                        <div class="day-card-title">${weekday}</div>
                        <div class="day-card-date">${monthDay}</div>
                    </div>
                    <div class="day-card-body">
            `;

            plans.forEach(plan => {
                const recipe = getRecipeById(plan.recipeId);
                if (recipe) {
                    html += `
                        <div class="day-meal-item" data-recipe-id="${recipe.id}">
                            <div class="day-meal-name">${recipe.name}</div>
                            <button class="day-meal-remove" data-plan-id="${plan.id}">&times;</button>
                        </div>
                    `;
                }
            });

            html += `
                        <div class="day-add-meal" data-date="${date}">+ Add Meal</div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('.day-add-meal').forEach(btn => {
            btn.addEventListener('click', () => {
                STATE.currentPlanDate = btn.dataset.date;
                showRecipePicker();
            });
        });

        container.querySelectorAll('.day-meal-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('day-meal-remove')) {
                    showRecipeDetail(item.dataset.recipeId);
                }
            });
        });

        container.querySelectorAll('.day-meal-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removePlan(btn.dataset.planId);
                renderPlannerGrid();
            });
        });
    }

    function showRecipePicker() {
        renderRecipePicker('');
        showModal('recipe-picker-modal');
    }

    function renderRecipePicker(searchTerm) {
        const list = document.getElementById('recipe-picker-list');
        let recipes = STATE.recipes;

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            recipes = recipes.filter(r => r.name.toLowerCase().includes(term));
        }

        if (recipes.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No recipes found.</p></div>';
            return;
        }

        list.innerHTML = recipes.map(recipe => `
            <div class="recipe-picker-item" data-recipe-id="${recipe.id}">
                <div class="recipe-picker-item-name">${recipe.name}</div>
                <div class="recipe-picker-item-category">${recipe.category}</div>
            </div>
        `).join('');

        list.querySelectorAll('.recipe-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                if (STATE.currentPlanDate) {
                    addPlan(STATE.currentPlanDate, item.dataset.recipeId);
                    hideModal('recipe-picker-modal');
                    renderPlannerGrid();
                }
            });
        });
    }

    function generateShoppingList() {
        const dates = getPlannerDateRange();
        const allIngredients = [];

        dates.forEach(date => {
            const datePlans = STATE.plans.filter(p => p.date === date);
            datePlans.forEach(plan => {
                const recipe = getRecipeById(plan.recipeId);
                if (recipe && recipe.ingredients) {
                    recipe.ingredients.forEach(ing => {
                        allIngredients.push({
                            ...ing,
                            id: generateUUID(),
                            recipeId: recipe.id,
                            recipeName: recipe.name
                        });
                    });
                }
            });
        });

        const grouped = {};

        allIngredients.forEach(ing => {
            const key = ing.item.toLowerCase().trim();

            if (!grouped[key]) {
                grouped[key] = {
                    item: ing.item,
                    category: ing.category,
                    entries: [],
                    recipeIds: new Set(),
                    recipeNames: []
                };
            }

            grouped[key].entries.push({
                id: ing.id,
                qty: ing.qty,
                unit: ing.unit
            });

            if (!grouped[key].recipeIds.has(ing.recipeId)) {
                grouped[key].recipeIds.add(ing.recipeId);
                grouped[key].recipeNames.push(ing.recipeName);
            }
        });

        const byCategory = {
            produce: [],
            dairy: [],
            meat: [],
            pantry: [],
            frozen: [],
            other: []
        };

        Object.values(grouped).forEach(group => {
            let combinedQty = '';
            let combinedUnit = '';

            if (group.entries.length === 1) {
                combinedQty = group.entries[0].qty;
                combinedUnit = group.entries[0].unit;
            } else {
                const units = group.entries.map(e => e.unit).filter(u => u);
                const uniqueUnits = [...new Set(units)];

                if (uniqueUnits.length === 1 && uniqueUnits[0]) {
                    const numbers = group.entries.map(e => {
                        const num = parseFloat(e.qty);
                        return isNaN(num) ? 0 : num;
                    });
                    const sum = numbers.reduce((a, b) => a + b, 0);
                    combinedQty = sum > 0 ? sum.toString() : group.entries.map(e => e.qty).filter(q => q).join(' + ');
                    combinedUnit = uniqueUnits[0];
                } else {
                    combinedQty = group.entries.map(e => `${e.qty} ${e.unit}`.trim()).join(', ');
                    combinedUnit = '';
                }
            }

            const itemId = group.entries[0].id;

            byCategory[group.category].push({
                id: itemId,
                qty: combinedQty,
                unit: combinedUnit,
                item: group.item,
                category: group.category,
                recipeNames: group.recipeNames
            });
        });

        Object.keys(byCategory).forEach(cat => {
            byCategory[cat].sort((a, b) => a.item.localeCompare(b.item));
        });

        return byCategory;
    }

    function renderShoppingList() {
        const container = document.getElementById('shopping-list');
        const shoppingList = generateShoppingList();

        const categories = [
            { key: 'produce', label: 'Produce' },
            { key: 'dairy', label: 'Dairy' },
            { key: 'meat', label: 'Meat' },
            { key: 'pantry', label: 'Pantry' },
            { key: 'frozen', label: 'Frozen' },
            { key: 'other', label: 'Other' }
        ];

        const hasItems = categories.some(cat => shoppingList[cat.key].length > 0);

        if (!hasItems) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No shopping items yet. Add some recipes to your meal plan!</p>
                </div>
            `;
            return;
        }

        let html = '';

        categories.forEach(cat => {
            const items = shoppingList[cat.key];
            if (items.length === 0) return;

            html += `
                <div class="shopping-category">
                    <h3 class="shopping-category-title">${cat.label}</h3>
                    ${items.map(item => {
                        const isChecked = STATE.shoppingChecked.includes(item.id);
                        const recipeNamesText = item.recipeNames && item.recipeNames.length > 0
                            ? ` — ${item.recipeNames.join(', ')}`
                            : '';
                        return `
                            <div class="shopping-item ${isChecked ? 'checked' : ''}" data-item-id="${item.id}">
                                <input type="checkbox" ${isChecked ? 'checked' : ''}>
                                <span class="shopping-item-text">
                                    ${item.qty ? item.qty + ' ' : ''}${item.unit ? item.unit + ' ' : ''}${item.item}<span class="shopping-item-recipes">${recipeNamesText}</span>
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('.shopping-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const itemId = e.target.closest('.shopping-item').dataset.itemId;

                if (e.target.checked) {
                    if (!STATE.shoppingChecked.includes(itemId)) {
                        STATE.shoppingChecked.push(itemId);
                    }
                    e.target.closest('.shopping-item').classList.add('checked');
                } else {
                    STATE.shoppingChecked = STATE.shoppingChecked.filter(id => id !== itemId);
                    e.target.closest('.shopping-item').classList.remove('checked');
                }

                saveShoppingChecked();
            });
        });
    }

    function clearCheckedItems() {
        STATE.shoppingChecked = [];
        saveShoppingChecked();
        renderShoppingList();
    }

    function renderCookPlan() {
        const container = document.getElementById('cookplan-list');
        const categoryFilter = document.getElementById('cookplan-category-filter').value;
        const dates = getPlannerDateRange();

        let hasPlans = false;

        let html = '';

        dates.forEach(date => {
            const plans = getPlansForDate(date);
            if (plans.length === 0) return;

            const filteredPlans = plans.filter(plan => {
                const recipe = getRecipeById(plan.recipeId);
                if (!recipe) return false;
                if (categoryFilter && recipe.category !== categoryFilter) return false;
                return true;
            });

            if (filteredPlans.length === 0) return;

            hasPlans = true;

            const { weekday, monthDay } = formatDayName(date);

            html += `
                <div class="cookplan-day">
                    <div class="cookplan-day-header">${weekday}, ${monthDay}</div>
                    <div class="cookplan-recipes">
            `;

            filteredPlans.forEach(plan => {
                const recipe = getRecipeById(plan.recipeId);
                if (recipe) {
                    html += `
                        <div class="cookplan-recipe-card" data-recipe-id="${recipe.id}">
                            <div class="cookplan-recipe-name">${recipe.name}</div>
                            <div class="cookplan-recipe-meta">
                                <span>Servings: ${recipe.servings}</span>
                                <span>Ingredients: ${recipe.ingredients.length}</span>
                            </div>
                            <div class="cookplan-recipe-category">${recipe.category}</div>
                        </div>
                    `;
                }
            });

            html += `
                    </div>
                </div>
            `;
        });

        if (!hasPlans) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No meals planned for this date range.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = html;

        container.querySelectorAll('.cookplan-recipe-card').forEach(card => {
            card.addEventListener('click', () => {
                showRecipeDetail(card.dataset.recipeId);
            });
        });
    }

    function renderCookItView() {
        const selectionContainer = document.getElementById('recipe-selection');
        const dates = getPlannerDateRange();

        // Count how many times each recipe appears in the plan
        const recipeCounts = new Map();
        dates.forEach(date => {
            const plans = getPlansForDate(date);
            plans.forEach(plan => {
                const recipe = getRecipeById(plan.recipeId);
                if (recipe) {
                    recipeCounts.set(recipe.id, (recipeCounts.get(recipe.id) || 0) + 1);
                }
            });
        });

        if (recipeCounts.size === 0) {
            selectionContainer.innerHTML = `
                <div class="empty-state">
                    <p>No recipes planned. Add recipes to your meal plan first.</p>
                </div>
            `;
            document.getElementById('cooking-guide').innerHTML = '';
            return;
        }

        let html = `
            <div class="recipe-selection-title">Select Recipes to Cook</div>
            <div class="recipe-checkboxes">
        `;

        recipeCounts.forEach((count, recipeId) => {
            const recipe = getRecipeById(recipeId);
            if (recipe) {
                const label = count > 1 ? `${recipe.name} (×${count})` : recipe.name;
                html += `
                    <div class="recipe-checkbox-item">
                        <input type="checkbox" id="recipe-${recipe.id}" value="${recipe.id}" data-count="${count}" checked>
                        <label for="recipe-${recipe.id}">${label}</label>
                    </div>
                `;
            }
        });

        html += `</div>`;
        selectionContainer.innerHTML = html;
    }

    function generateCookingGuide() {
        const checkboxes = document.querySelectorAll('#recipe-selection input[type="checkbox"]:checked');
        const selected = Array.from(checkboxes).map(cb => ({
            id: cb.value,
            count: parseInt(cb.dataset.count) || 1
        }));

        if (selected.length === 0) {
            showAppAlert('Please select at least one recipe.');
            return;
        }

        const recipeEntries = selected.map(s => {
            const recipe = getRecipeById(s.id);
            return recipe ? { recipe, count: s.count } : null;
        }).filter(r => r);

        const steps = [];
        let stepNumber = 1;

        // --- Phase 1: Scaled Ingredient Prep ---
        // Collect all ingredients scaled by recipe count, grouped by item
        const ingredientGroups = new Map();
        recipeEntries.forEach(({ recipe, count }) => {
            recipe.ingredients.forEach(ing => {
                const key = ing.item.toLowerCase().trim();
                if (!ingredientGroups.has(key)) {
                    ingredientGroups.set(key, {
                        item: ing.item,
                        unit: ing.unit,
                        totalQty: 0,
                        hasNumericQty: true,
                        rawQties: [],
                        sources: []
                    });
                }
                const group = ingredientGroups.get(key);
                const parsed = parseFloat(ing.qty);
                if (!isNaN(parsed)) {
                    group.totalQty += parsed * count;
                } else {
                    group.hasNumericQty = false;
                    group.rawQties.push(ing.qty ? `${ing.qty}` : '');
                }
                if (!group.unit && ing.unit) group.unit = ing.unit;

                const label = count > 1 ? `${recipe.name} ×${count}` : recipe.name;
                if (!group.sources.includes(label)) {
                    group.sources.push(label);
                }
            });
        });

        // Generate prep steps for ingredients
        ingredientGroups.forEach((group) => {
            let qtyText;
            if (group.hasNumericQty && group.totalQty > 0) {
                qtyText = `${group.totalQty}${group.unit ? ' ' + group.unit : ''}`;
            } else if (group.rawQties.length > 0) {
                qtyText = group.rawQties.filter(q => q).join(' + ');
            } else {
                qtyText = '';
            }

            const prepText = qtyText
                ? `Prepare ${qtyText} ${group.item} (for ${group.sources.join(', ')})`
                : `Prepare ${group.item} (for ${group.sources.join(', ')})`;

            steps.push({
                number: stepNumber++,
                text: prepText,
                recipes: group.sources,
                phase: 'prep'
            });
        });

        // --- Phase 2: Oven Preheat Summary ---
        // Scan recipe steps for oven temps, generate a preheat reminder (not ripped from sequence)
        const ovenTemps = new Map();
        recipeEntries.forEach(({ recipe, count }) => {
            recipe.steps.forEach(step => {
                const lowerStep = step.toLowerCase();
                const tempMatch = lowerStep.match(/(\d+)\s*°?\s*f/i) || lowerStep.match(/(\d+)\s*degrees/i);
                if (tempMatch || lowerStep.includes('preheat') || lowerStep.includes('oven')) {
                    const temp = tempMatch ? parseInt(tempMatch[1]) : null;
                    if (temp && temp >= 200 && temp <= 600) {
                        const label = count > 1 ? `${recipe.name} ×${count}` : recipe.name;
                        if (!ovenTemps.has(temp)) {
                            ovenTemps.set(temp, []);
                        }
                        if (!ovenTemps.get(temp).includes(label)) {
                            ovenTemps.get(temp).push(label);
                        }
                    }
                }
            });
        });

        // Sort temps low to high and add preheat reminders
        const sortedTemps = Array.from(ovenTemps.entries()).sort((a, b) => a[0] - b[0]);
        sortedTemps.forEach(([temp, sources]) => {
            steps.push({
                number: stepNumber++,
                text: `Preheat oven to ${temp}°F (needed for ${sources.join(', ')})`,
                recipes: sources,
                phase: 'oven'
            });
        });

        // --- Phase 3: Recipe Steps in ORIGINAL ORDER ---
        // Each recipe's steps preserved exactly as written, with multiplier noted
        recipeEntries.forEach(({ recipe, count }) => {
            const label = count > 1 ? `${recipe.name} ×${count}` : recipe.name;
            const batchNote = count > 1 ? ` [×${count} batches]` : '';

            recipe.steps.forEach((step) => {
                steps.push({
                    number: stepNumber++,
                    text: step + batchNote,
                    recipes: [label],
                    phase: 'cooking'
                });
            });
        });

        renderCookingGuide(steps);
    }

    function renderCookingGuide(steps) {
        const container = document.getElementById('cooking-guide');

        if (steps.length === 0) {
            container.innerHTML = '';
            return;
        }

        let html = `
            <div class="cooking-guide-title">Batch Cook Plan — ${steps.length} Steps</div>
            <div class="cooking-steps">
        `;

        steps.forEach(step => {
            html += `
                <div class="cooking-step step-phase-${step.phase}" data-step-number="${step.number}">
                    <div class="step-checkbox">
                        <input type="checkbox" id="step-${step.number}">
                    </div>
                    <div class="step-number">${step.number}</div>
                    <div class="step-content">
                        <div class="step-text">${step.text}</div>
                        <div class="step-recipes">
                            ${step.recipes.map(r => `<span class="step-recipe-tag">${r}</span>`).join('')}
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;

        container.querySelectorAll('.step-checkbox input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const stepEl = e.target.closest('.cooking-step');
                if (e.target.checked) {
                    stepEl.classList.add('completed');
                } else {
                    stepEl.classList.remove('completed');
                }
            });
        });
    }

    function updateSettingsForm() {
        document.getElementById('default-week-length').value = STATE.settings.weekLength;
    }

    function saveSettingsFromForm() {
        STATE.settings.weekLength = parseInt(document.getElementById('default-week-length').value) || 7;
        saveSettings();

        const durationSlider = document.getElementById('planner-duration');
        if (durationSlider) {
            durationSlider.value = STATE.settings.weekLength;
            document.getElementById('duration-value').textContent = STATE.settings.weekLength;
            renderPlannerGrid();
        }
    }

    let currentTooltip = null;

    function showTooltip(element, text) {
        hideTooltip();

        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = text;
        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let top = rect.bottom + 8;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }

        if (top + tooltipRect.height > window.innerHeight - 10) {
            top = rect.top - tooltipRect.height - 8;
        }

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';

        currentTooltip = tooltip;
    }

    function hideTooltip() {
        if (currentTooltip) {
            currentTooltip.remove();
            currentTooltip = null;
        }
    }

    function setupTooltips() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('help-icon')) {
                e.stopPropagation();
                const helpText = e.target.dataset.help;
                if (helpText) {
                    showTooltip(e.target, helpText);
                }
            } else {
                hideTooltip();
            }
        });
    }

    function setupEventListeners() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                switchView(btn.dataset.view);
            });
        });

        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                hideModal(btn.dataset.modal);
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                    document.body.style.overflow = '';
                }
            });
        });

        document.getElementById('settings-btn').addEventListener('click', () => {
            updateSettingsForm();
            if (window.CloudSync) CloudSync.populateSettingsForm();
            showModal('settings-modal');
        });

        document.getElementById('add-recipe-btn').addEventListener('click', () => {
            openRecipeForm();
        });

        document.getElementById('recipe-search').addEventListener('input', () => {
            renderRecipeGrid();
        });

        document.getElementById('recipe-filter').addEventListener('change', () => {
            renderRecipeGrid();
        });

        document.getElementById('recipe-form').addEventListener('submit', handleRecipeSubmit);

        document.getElementById('recipe-image').addEventListener('change', handleImageUpload);

        document.getElementById('add-ingredient-btn').addEventListener('click', () => {
            const ingredients = collectIngredients();
            ingredients.push({ qty: '', unit: '', item: '', category: 'produce' });
            renderIngredients(ingredients);
        });

        document.getElementById('add-step-btn').addEventListener('click', () => {
            const steps = collectSteps();
            steps.push('');
            renderSteps(steps);
        });

        document.getElementById('edit-recipe-btn').addEventListener('click', () => {
            hideModal('recipe-detail-modal');
            openRecipeForm(STATE.currentRecipeId);
        });

        document.getElementById('delete-recipe-btn').addEventListener('click', () => {
            showAppConfirm('Are you sure you want to delete this recipe?', function() {
                deleteRecipe(STATE.currentRecipeId);
                hideModal('recipe-detail-modal');
                renderRecipeGrid();
            }, null, 'Delete', 'Cancel');
        });

        document.getElementById('ocr-btn').addEventListener('click', handleOCRScan);

        document.getElementById('parse-ocr-btn').addEventListener('click', parseOCRText);

        document.getElementById('planner-start-date').addEventListener('change', () => {
            renderPlannerGrid();
        });

        document.getElementById('planner-duration').addEventListener('input', (e) => {
            document.getElementById('duration-value').textContent = e.target.value;
            renderPlannerGrid();
        });

        document.getElementById('generate-shopping-btn').addEventListener('click', () => {
            switchView('shopping-view');
        });

        document.getElementById('picker-search').addEventListener('input', (e) => {
            renderRecipePicker(e.target.value);
        });

        document.getElementById('clear-checked-btn').addEventListener('click', clearCheckedItems);

        document.getElementById('cookplan-category-filter').addEventListener('change', () => {
            renderCookPlan();
        });

        document.getElementById('generate-guide-btn').addEventListener('click', generateCookingGuide);

        document.getElementById('export-data-btn').addEventListener('click', exportData);

        document.getElementById('import-data-btn').addEventListener('click', () => {
            document.getElementById('import-file-input').click();
        });

        document.getElementById('import-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                importData(event.target.result);
            };
            reader.readAsText(file);
        });

        document.getElementById('clear-data-btn').addEventListener('click', clearAllData);

        document.getElementById('default-week-length').addEventListener('change', saveSettingsFromForm);

        document.getElementById('import-recipe-btn').addEventListener('click', () => {
            if (window.RecipeLoader) window.RecipeLoader.show();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close the topmost active modal
                const modals = document.querySelectorAll('.modal-overlay.active');
                if (modals.length > 0) {
                    const topModal = modals[modals.length - 1];
                    // Don't close recipe-loader-modal from here (it has its own handler with unsaved work check)
                    if (topModal.id !== 'recipe-loader-modal') {
                        topModal.classList.remove('active');
                        document.body.style.overflow = '';
                    }
                }
            }
        });
    }

    function init() {
        loadAllData();
        setupEventListeners();
        setupTooltips();

        document.getElementById('planner-start-date').value = STATE.settings.weekStartDate || getTodayString();
        document.getElementById('planner-duration').value = STATE.settings.weekLength;
        document.getElementById('duration-value').textContent = STATE.settings.weekLength;

        renderRecipeGrid();
        renderPlannerGrid();
        renderShoppingList();

        switchView('recipes-view');

        if (window.RecipeLoader) window.RecipeLoader.init();

        // Cloud sync initialization
        if (window.CloudSync) {
            CloudSync.init();
            var syncConfig = CloudSync.getConfig();
            if (syncConfig.enabled && syncConfig.firebaseUrl) {
                CloudSync.loadAll().then(function(cloudData) {
                    if (cloudData) {
                        if (cloudData.recipes) {
                            STATE.recipes = cloudData.recipes;
                            localStorage.setItem('mp_recipes', JSON.stringify(STATE.recipes));
                        }
                        if (cloudData.plans) {
                            STATE.plans = cloudData.plans;
                            localStorage.setItem('mp_plans', JSON.stringify(STATE.plans));
                        }
                        if (cloudData.settings) {
                            STATE.settings = cloudData.settings;
                            localStorage.setItem('mp_settings', JSON.stringify(STATE.settings));
                        }
                        if (cloudData.shopping_checked) {
                            STATE.shoppingChecked = cloudData.shopping_checked;
                            localStorage.setItem('mp_shopping_checked', JSON.stringify(STATE.shoppingChecked));
                        }
                        renderRecipeGrid();
                        renderPlannerGrid();
                        renderShoppingList();
                        document.getElementById('planner-start-date').value = STATE.settings.weekStartDate || getTodayString();
                        document.getElementById('planner-duration').value = STATE.settings.weekLength;
                        document.getElementById('duration-value').textContent = STATE.settings.weekLength;
                    }
                    // Start polling for changes from other devices
                    CloudSync.startPolling(function(data) {
                        if (data) {
                            var changed = false;
                            if (data.recipes && JSON.stringify(data.recipes) !== JSON.stringify(STATE.recipes)) {
                                STATE.recipes = data.recipes;
                                localStorage.setItem('mp_recipes', JSON.stringify(STATE.recipes));
                                changed = true;
                            }
                            if (data.plans && JSON.stringify(data.plans) !== JSON.stringify(STATE.plans)) {
                                STATE.plans = data.plans;
                                localStorage.setItem('mp_plans', JSON.stringify(STATE.plans));
                                changed = true;
                            }
                            if (changed) {
                                renderRecipeGrid();
                                renderPlannerGrid();
                                renderShoppingList();
                            }
                        }
                    });
                });
            }
        }
    }

    // Expose API for recipe-loader.js and sync.js
    window.MealPlannerAPI = {
        createRecipe: createRecipe,
        renderRecipeGrid: renderRecipeGrid,
        renderPlannerGrid: renderPlannerGrid,
        renderShoppingList: renderShoppingList,
        showModal: showModal,
        hideModal: hideModal,
        showAppConfirm: showAppConfirm,
        showAppAlert: showAppAlert,
        getStateForSync: function() {
            return {
                recipes: STATE.recipes,
                plans: STATE.plans,
                settings: STATE.settings,
                shopping_checked: STATE.shoppingChecked
            };
        },
        applyCloudData: function(data) {
            if (data.recipes) STATE.recipes = data.recipes;
            if (data.plans) STATE.plans = data.plans;
            if (data.settings) STATE.settings = data.settings;
            if (data.shopping_checked) STATE.shoppingChecked = data.shopping_checked;
            saveRecipes();
            savePlans();
            saveSettings();
            saveShoppingChecked();
            renderRecipeGrid();
            renderPlannerGrid();
            renderShoppingList();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
