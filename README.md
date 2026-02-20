# Meal Planner App

A complete single-page meal planning application built with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools required.

## Features

### Recipe Management
- Create, edit, and delete recipes
- Categorize recipes (Breakfast, Lunch, Dinner, Snack, Dessert)
- Upload recipe images
- Track ingredients with quantities, units, and categories
- Step-by-step cooking instructions
- Search and filter recipes

### OCR Recipe Import
- Scan recipe images using Tesseract.js
- Automatic text extraction from photos
- Smart parsing of recipe name, ingredients, and steps
- Edit and refine extracted data before saving

### Meal Planning
- Plan meals for 1-14 days
- Grid view with days and meal times
- Drag-free recipe assignment
- Visual meal calendar
- Easy recipe swapping

### Smart Shopping List
- Auto-aggregated from meal plans
- Ingredients grouped by category (Produce, Dairy, Meat, Pantry, Frozen, Other)
- Quantity combining for duplicate items
- Checkable items with persistence
- Clear checked items feature

### Data Management
- All data stored in localStorage
- Export data as JSON backup
- Import data from JSON file
- Clear all data option

## Usage

1. Open `index.html` in any modern web browser
2. Start adding recipes using the floating "+" button
3. Plan your meals in the Planner tab
4. Generate your shopping list from planned meals

## File Structure

```
meal-planner/
├── index.html    # Main HTML structure
├── styles.css    # Complete styling (dark theme with royal blue accents)
├── app.js        # Full application logic
└── README.md     # This file
```

## Color Scheme

- Background: `#0d1117` (dark)
- Surface/cards: `#161b22` (dark gray)
- Accent: `#4169E1` (royal blue)
- Text: `#e6edf3` (light)
- Muted: `#8b949e` (gray)
- Borders: `#30363d` (subtle)

## Data Storage

All data is stored in browser localStorage:
- `mp_recipes` - Recipe collection
- `mp_plans` - Meal plan assignments
- `mp_settings` - User preferences
- `mp_shopping_checked` - Checked shopping items

## Browser Compatibility

Works in all modern browsers supporting:
- ES6 JavaScript
- CSS Grid
- localStorage
- FileReader API
- Crypto API (for UUID generation)

## No Dependencies

The only external dependency is Tesseract.js (loaded via CDN) for OCR functionality. The app will work without it, minus the recipe scanning feature.

## Touch-Friendly

- Minimum 48px tap targets
- Bottom tab navigation for thumb access
- Large, clear buttons
- Responsive design for mobile and tablet

## Privacy

All data stays on your device. Nothing is sent to any server. Export your data regularly as a backup.
