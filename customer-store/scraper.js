#!/usr/bin/env node

/**
 * Shopify Product Scraper
 * Fetches products from Shopify store and saves them as JSON
 *
 * Usage: node scraper.js
 * Or: npm run scrape
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SHOPIFY_STORE = 'blackstarthebrand.myshopify.com';
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

function fetchProducts(limit = 250) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SHOPIFY_STORE,
      path: `/products.json?limit=${limit}`,
      method: 'GET',
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        console.log(`Following redirect to: ${redirectUrl}`);
        return reject(new Error(`Redirect not handled: ${redirectUrl}`));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }

      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.products || []);
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

function formatProducts(products) {
  return products.map(product => {
    const variant = product.variants?.[0];
    const image = product.images?.[0];

    return {
      id: product.id,
      title: product.title,
      price: variant?.price || '0',
      currency: variant?.currency_code || 'USD',
      image: image?.src || '',
      alt: image?.alt || product.title,
      url: `/products/${product.handle}`,
      handle: product.handle,
      description: product.body_html || ''
    };
  });
}

async function main() {
  try {
    console.log(`Fetching products from https://${SHOPIFY_STORE}...`);
    const products = await fetchProducts();

    if (products.length === 0) {
      console.warn('⚠ No products found in response');
      return;
    }

    const formatted = formatProducts(products);

    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(formatted, null, 2));
    console.log(`✓ Successfully scraped ${formatted.length} products`);
    console.log(`✓ Saved to products.json`);
    console.log('\nSample products:');
    formatted.slice(0, 3).forEach(p => {
      console.log(`  - ${p.title} ($${parseFloat(p.price).toFixed(2)})`);
    });
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    console.error('\nTroubleshooting:');
    console.error('- Check that you have internet access');
    console.error('- Verify the Shopify store URL is correct');
    console.error(`- The Shopify API endpoint should be: https://${SHOPIFY_STORE}/products.json`);
    process.exit(1);
  }
}

main();
