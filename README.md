# Upcart — Modern E-Commerce Platform

A complete, serverless e-commerce solution designed to scale. Consists of a powerful backend API (Cloudflare Workers), a modern admin dashboard for product and order management, and a clean customer-facing store.

## 🚀 Overview

**Upcart** is a full-stack e-commerce platform built on modern serverless infrastructure. It's optimized for fast deployment, low maintenance, and seamless scaling.

### Key Features

- **Serverless Backend** — Built on Cloudflare Workers for instant global deployment
- **Product Management** — Full CRUD operations for products, inventory, and descriptions
- **Secure Admin Portal** — JWT-authenticated dashboard for managing products, orders, and discounts
- **Checkout System** — Integrated Stripe checkout with support for Apple Pay and Google Pay
- **Discount Codes** — Validate and apply discount codes at checkout time
- **Order Tracking** — Customers can look up order status and shipping information
- **Shipping Integration** — Automatic shipping calculation at checkout
- **Multi-Currency Support** — Handle multiple currencies with proper price formatting
- **Static Site Optimization** — Both frontends deploy as static sites for minimal overhead
- **Responsive Design** — Mobile-first design works on all screen sizes

---

## 📁 Project Structure

```
upcart/
├── backend/                 # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts        # Main API entry point
│   │   ├── routes/         # API route handlers
│   │   ├── middleware/     # Auth, CORS, CSRF
│   │   └── db/             # Database adapters (D1, MongoDB)
│   ├── migrations/         # SQL migrations
│   ├── wrangler.toml       # Cloudflare Workers config
│   ├── API.md              # Frontend API documentation
│   └── ADMIN_API.md        # Admin portal API documentation
│
├── admin-dashboard/         # Admin portal frontend
│   ├── public/             # Static assets
│   ├── src/                # React/frontend code
│   ├── package.json
│   └── server.js           # Dev/build server
│
└── customer-store/         # Customer-facing store
    ├── index.html          # Home page
    ├── products.html       # Product catalog
    ├── product.html        # Product detail
    ├── cart.html           # Shopping cart & checkout
    ├── cart.js             # Cart state management
    ├── config.js           # API configuration
    └── package.json        # Dependencies
```

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend API** | Cloudflare Workers, TypeScript, Stripe, D1/MongoDB |
| **Admin Dashboard** | React/Vanilla JS, Vite/Webpack |
| **Customer Store** | Vanilla HTML/CSS/JS, Stripe.js |
| **Database** | Cloudflare D1 (SQLite) or MongoDB Atlas |
| **Deployment** | Cloudflare Workers, Render, Cloudflare Pages |

---

## 📚 API Documentation

### Frontend API Reference
Complete API documentation for the customer-facing store.
- **File**: [`backend/API.md`](backend/API.md)
- **Endpoints**: Products, Discounts, Orders, Checkout, Shipping

### Admin API Reference
Complete API documentation for the admin dashboard.
- **File**: [`backend/ADMIN_API.md`](backend/ADMIN_API.md)
- **Endpoints**: Login, Products (CRUD), Orders, Discounts, Analytics

---

## 🚀 Deployment Guide

### Prerequisites

- Node.js 18+ and npm
- Stripe account (for payments)
- Cloudflare account (for Workers and Pages/R2)
- Render account (optional, for static hosting)
- Git CLI

---

## Backend: Cloudflare Workers

### 1. Setup

```bash
cd backend
npm install
```

### 2. Configure Environment

Create a `.dev.vars` file:

```env
# Database (choose one)
DATABASE_TYPE=d1  # or "mongodb"
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# CORS & Security
CORS_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com

# Shipping (optional)
SHIPPING_API_KEY=your-shipping-provider-key
```

### 3. Setup Database

**For Cloudflare D1 (SQLite):**

```bash
npx wrangler d1 create upcart-db
```

Run migrations:

```bash
npx wrangler d1 execute upcart-db --file=./migrations/0001_create_products.sql
npx wrangler d1 execute upcart-db --file=./migrations/0002_create_orders.sql
npx wrangler d1 execute upcart-db --file=./migrations/0003_create_discounts.sql
```

**For MongoDB Atlas:**

1. Create a cluster at [mongodb.com](https://www.mongodb.com)
2. Get your connection URI
3. Add to `.dev.vars`: `MONGODB_URI=mongodb+srv://...`

### 4. Deploy

**Development:**

```bash
npm run dev
```

The API will run at `http://localhost:8787`

**Production:**

```bash
npm run deploy
```

Or with Wrangler directly:

```bash
npx wrangler publish
```

Your API will be available at: `https://<your-worker-name>.workers.dev`

### 5. Post-Deployment

1. Update `wrangler.toml` with your D1 database ID (if using D1)
2. Set production secrets in Cloudflare Dashboard:
   - **Settings → Variables**
   - Add: `STRIPE_SECRET_KEY`, `ADMIN_PASSWORD`, etc.
3. Configure custom domain (optional):
   - **Workers → your-worker → Settings → Custom Domains**

---

## Admin Dashboard: Render or Cloudflare Pages

The admin dashboard is a static site that communicates with the backend API.

### 1. Build Locally

```bash
cd admin-dashboard
npm install
npm run build
```

This creates a `dist/` (or `build/`) directory with static files.

### 2. Deploy to Render

1. Push your repo to GitHub
2. Go to [render.com](https://render.com) → **New → Static Site**
3. Connect your GitHub repo
4. **Build Command**: `npm run build`
5. **Publish Directory**: `dist` (or `build`)
6. Set environment variables:
   - `REACT_APP_API_URL=https://<your-worker>.workers.dev`
7. Deploy

### 3. Deploy to Cloudflare Pages

1. Push your repo to GitHub
2. Go to Cloudflare Dashboard → **Pages → Create Project**
3. Connect your GitHub repo
4. **Build Command**: `npm run build`
5. **Build Output Directory**: `dist`
6. Set environment variables:
   - `VITE_API_URL=https://<your-worker>.workers.dev` (or `REACT_APP_API_URL`)
7. Deploy

### 4. Configure API URL

Update `admin-dashboard/config.js` or environment variables:

```javascript
const API_BASE = process.env.REACT_APP_API_URL || 'https://<your-worker>.workers.dev';
```

---

## Customer Store: Render or Cloudflare Pages

The customer store is a static HTML/CSS/JS site.

### 1. Configure API URL

Edit `customer-store/config.js`:

```javascript
const API_BASE = 'https://<your-worker>.workers.dev';
const STRIPE_PUBLISHABLE_KEY = 'pk_test_...';
```

### 2. Deploy to Render

1. Push your repo to GitHub
2. Go to [render.com](https://render.com) → **New → Static Site**
3. Connect your GitHub repo
4. **Publish Directory**: `customer-store`
5. Deploy

Your store will be available at: `https://your-site.onrender.com`

### 3. Deploy to Cloudflare Pages

1. Push your repo to GitHub
2. Go to Cloudflare Dashboard → **Pages → Create Project**
3. Connect your GitHub repo
4. **Build Command**: `npm run build` (if using a build step, otherwise leave blank)
5. **Build Output Directory**: `customer-store`
6. Deploy

Your store will be available at: `https://your-site.pages.dev`

### 4. Apple Pay Domain Verification

To enable Apple Pay on your store:

1. In Stripe Dashboard → **Settings → Payment methods → Apple Pay**
2. Add your domain and download the verification file
3. Create `.well-known/apple-developer-merchantid-domain-association` at your site root
4. Paste the verification file content
5. On Render: Add to root directory before deploying
6. On Cloudflare Pages: Add to `customer-store/.well-known/` before deploying

---

## 🔐 Security Checklist

Before going to production:

- [ ] Set strong `ADMIN_PASSWORD` in all environments
- [ ] Use Stripe **Production** keys (not test keys)
- [ ] Enable HTTPS on all domains
- [ ] Set `CORS_ORIGINS` to your exact domains (not wildcard `*`)
- [ ] Enable CSRF protection in middleware
- [ ] Store secrets in environment variables, never in code
- [ ] Set JWT expiration appropriately (default: 8 hours)
- [ ] Enable rate limiting on API endpoints
- [ ] Monitor Cloudflare Workers logs for errors
- [ ] Test checkout with Stripe test cards first

---

## 🧪 Testing the Full Flow

### 1. Add a Product (Admin)

1. Log in to admin dashboard
2. Click "New Product"
3. Enter name, price (in cents), description, image URL
4. Click "Create"

### 2. View Product (Customer)

1. Go to customer store
2. Click "Shop"
3. Your product should appear in the grid
4. Click to view details

### 3. Test Checkout

1. Add product to cart
2. Go to cart page
3. Click "Checkout"
4. Use Stripe test card: `4242 4242 4242 4242`
5. Complete payment
6. Check order status in customer store

### 4. Apply Discount Code (Admin)

1. In admin dashboard, create a discount code
2. Set percentage or fixed amount
3. In customer checkout, paste the code
4. Verify discount applies

---

## 📊 Monitoring & Debugging

### Backend Logs

**Cloudflare Workers:**

```bash
npx wrangler tail
```

This streams real-time logs from your deployed worker.

### Database Debugging

**D1 (SQLite):**

```bash
npx wrangler d1 execute upcart-db --command="SELECT * FROM products"
```

**MongoDB:**

Use MongoDB Atlas dashboard or:

```bash
mongosh "mongodb+srv://..."
```

### API Testing

Use cURL or Postman:

```bash
# List products
curl https://<your-worker>.workers.dev/products

# Admin login
curl -X POST https://<your-worker>.workers.dev/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}'

# Create product (requires token)
curl -X POST https://<your-worker>.workers.dev/admin/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Product","price":2999,"currency":"usd"}'
```

---

## 🌍 Multi-Environment Setup

### Development

```
Backend: http://localhost:8787
Admin: http://localhost:5173 (Vite) or 3000 (other)
Store: http://localhost:8080 or file://
```

### Staging

```
Backend: https://staging-api.example.com (separate worker)
Admin: https://admin-staging.example.com
Store: https://staging.example.com
```

### Production

```
Backend: https://api.example.com
Admin: https://admin.example.com
Store: https://www.example.com
```

---

## 🐛 Common Issues

### Issue: "Worker not found"

**Solution**: Ensure you've deployed the backend:
```bash
cd backend && npm run deploy
```

### Issue: "CORS error" on checkout

**Solution**: Add your store domain to `CORS_ORIGINS` in worker settings.

### Issue: Products not showing up

**Solution**: 
1. Verify backend is running: `curl https://<your-worker>.workers.dev/products`
2. Check admin dashboard → Products (make sure products exist)
3. Check browser console for API errors

### Issue: Apple Pay not showing

**Solution**: 
1. Verify domain is verified in Stripe
2. Check `.well-known/apple-developer-merchantid-domain-association` file exists
3. Use HTTPS (required for Apple Pay)

### Issue: "Unauthorized" on admin endpoints

**Solution**:
1. Re-login to get a new token
2. Check token is in `Authorization: Bearer <token>` header
3. Verify admin credentials match `ADMIN_PASSWORD` in environment

---

## 📖 Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Render Deployment Docs](https://render.com/docs)
- [Cloudflare Pages Deployment](https://developers.cloudflare.com/pages/)
- **API Docs**: See [`backend/API.md`](backend/API.md) and [`backend/ADMIN_API.md`](backend/ADMIN_API.md)

---

## 📝 License

This project is provided as-is. Modify and use freely for your needs.

---

## 🤝 Support

For issues or questions:

1. Check the documentation in `backend/API.md` and `backend/ADMIN_API.md`
2. Review Cloudflare Workers logs: `npx wrangler tail`
3. Test endpoints with cURL or Postman
4. Check that all environment variables are set correctly

---

**Made with ❤️ for modern e-commerce.**
