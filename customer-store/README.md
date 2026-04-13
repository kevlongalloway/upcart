# BLACKSTAR - Product Scraper Setup

This project includes an automated Shopify product scraper that fetches products from the BLACKSTAR Shopify store and displays them on the website.

## Files

- **index.html** - Main website with dynamically loaded products
- **scraper.js** - Node.js script to scrape Shopify products
- **products.json** - JSON file containing scraped products (auto-generated)
- **package.json** - Node.js project configuration

## Quick Start

### 1. Install Dependencies (if needed)
```bash
npm install
```

### 2. Scrape Products from Shopify
```bash
npm run scrape
# or
node scraper.js
```

This will:
- Connect to https://blackstarthebrand.myshopify.com/products.json
- Fetch all product data (up to 250 products)
- Extract: title, price, images, product URLs
- Save to `products.json`

### 3. View the Website
Open `index.html` in your browser. Products will load automatically from `products.json`.

## How It Works

### Scraper Flow
1. Fetches product data from Shopify's public JSON API
2. Formats data into a clean structure
3. Saves to `products.json`

### Website Flow
1. `index.html` loads
2. JavaScript reads `products.json`
3. Products render dynamically in the grid
4. Each product links to its Shopify page

## Product Structure

Each product in `products.json` includes:
```json
{
  "id": 12345,
  "title": "Product Name",
  "price": "99.99",
  "currency": "USD",
  "image": "https://...",
  "alt": "Product image",
  "url": "/products/product-handle",
  "handle": "product-handle",
  "description": "Product HTML description"
}
```

## Troubleshooting

### Scraper fails to connect
- Check internet connection
- Verify the store URL is correct
- Check if Shopify has disabled the `/products.json` endpoint

### Products not showing on website
- Ensure `products.json` exists in the same directory as `index.html`
- Check browser console (F12) for JavaScript errors
- Verify the JSON file is valid

### Empty products.json
- Run the scraper: `npm run scrape`
- Check that it completes successfully

## Deployment on Render

### Setup

1. **Connect repo to Render**
   - Push your code to GitHub
   - Create a new Static Site on Render
   - Connect your GitHub repo
   - Render will detect `render.yaml` and deploy

2. **Automatic Product Updates via GitHub Actions**
   - GitHub Actions runs the scraper daily at 2 AM UTC
   - Commits updated `products.json` to your repo
   - Render automatically redeploys with new products
   - Site stays fully static—no server-side processing

### How It Works

```
GitHub Actions (Daily) → Scrapes Shopify → Commits products.json → Render redeploys with new data
```

The site is 100% static HTML/CSS/JS served by Render, with products data automatically updated daily.

## Local Automation

To test the scraper locally:
- Use a cron job on Linux/Mac:
  ```bash
  0 2 * * * cd /path/to/Blackstar && npm run scrape
  ```
- Use Windows Task Scheduler for Windows machines

## API Reference

The scraper uses Shopify's public JSON API:
```
https://{store}.myshopify.com/products.json
```

This endpoint returns up to 250 products per request.
