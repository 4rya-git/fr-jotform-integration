require('dotenv').config();
const express = require('express');
const multer = require('multer');
const xmlrpc = require('xmlrpc');

const app = express();
const upload = multer();

const {
    ODOO_URL,
    ODOO_DB,
    ODOO_USERNAME,
    ODOO_PASSWORD,
    FULFILLMENT_API_URL,
    FULFILLMENT_API_KEY,
    PORT
} = process.env;

// Odoo XML-RPC clients
const common = xmlrpc.createClient({ url: `${ODOO_URL}/xmlrpc/2/common` });
const object = xmlrpc.createClient({ url: `${ODOO_URL}/xmlrpc/2/object` });

// Authenticate at startup
let uid = null;
common.methodCall('authenticate', [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}], (err, res) => {
    if (err || !res) {
        console.error('Odoo auth failed:', err || 'Invalid credentials');
        process.exit(1);
    }
    uid = res;
    console.log('Connected to Odoo, UID:', uid);
});

// Helper function to create or find a customer
async function createOrFindCustomer(customerName, customerEmail, contactNumber, billing) {
    return new Promise((resolve, reject) => {
        object.methodCall('execute_kw', [
            ODOO_DB, uid, ODOO_PASSWORD,
            'res.partner', 'search',
            [[['email', '=', customerEmail]]]
        ], (err, ids) => {
            if (err) return reject(err);
            if (ids.length) return resolve(ids[0]);

            // Customer doesn't exist, create a new one
            object.methodCall('execute_kw', [
                ODOO_DB, uid, ODOO_PASSWORD,
                'res.partner', 'create',
                [{
                    name: customerName,
                    email: customerEmail,
                    phone: contactNumber,
                    street: billing.addr_line1 || '',
                    street2: billing.addr_line2 || '',
                    city: billing.city || '',
                    zip: billing.postal || '',
                    country_id: null // You may need to map country names to IDs
                }]
            ], (err, newId) => {
                if (err) return reject(err);
                resolve(newId);
            });
        });
    });
}

// Helper function to create or find a product
async function findOrCreateProduct(productName, price) {
    return new Promise((resolve, reject) => {
        object.methodCall('execute_kw', [
            ODOO_DB, uid, ODOO_PASSWORD,
            'product.product', 'search_read',
            [[['name', '=', productName]]],
            { fields: ['id'], limit: 1 }
        ], (err, result) => {
            if (err) return reject(err);
            if (result.length > 0) {
                return resolve(result[0].id);
            }

            // Product not found, create a new one
            object.methodCall('execute_kw', [
                ODOO_DB, uid, ODOO_PASSWORD,
                'product.product', 'create',
                [{
                    name: productName,
                    list_price: price,
                    type: 'consu'
                }]
            ], (err, newId) => {
                if (err) return reject(err);
                resolve(newId);
            });
        });
    });
}

// Helper function to create a sale order
async function createSaleOrder(customerId, orderLines) {
    return new Promise((resolve, reject) => {
        object.methodCall('execute_kw', [
            ODOO_DB, uid, ODOO_PASSWORD,
            'sale.order', 'create',
            [{
                partner_id: customerId,
                order_line: orderLines
            }]
        ], (err, id) => {
            if (err) return reject(err);
            resolve(id);
        });
    });
}

// Helper function to confirm a sale order
async function confirmSaleOrder(saleOrderId) {
    return new Promise((resolve, reject) => {
        object.methodCall('execute_kw', [
            ODOO_DB, uid, ODOO_PASSWORD,
            'sale.order', 'action_confirm',
            [saleOrderId]
        ], (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

// Main webhook route to handle incoming form submissions
app.post('/webhook', upload.none(), async (req, res) => {
    try {
        const rawRequest = JSON.parse(req.body.rawRequest);
        const products = rawRequest.q54_myProduct?.products || [];

        const customerName = `${rawRequest.q20_fullName?.first || ''} ${rawRequest.q20_fullName?.last || ''}`.trim();
        const customerEmail = rawRequest.q23_email || `${Date.now()}@noemail.com`;
        const contactNumber = rawRequest.q19_phoneNumber?.full || '';
        const billing = rawRequest.q21_deliveryAddress || {};

        if (products.length === 0) {
            throw new Error('No products found in the form submission');
        }

        // Step 1: Create or find the customer
        const customerId = await createOrFindCustomer(customerName, customerEmail, contactNumber, billing);

        // Step 2: Format and create order lines
        const odooOrderLines = [];
        for (const product of products) {
            const formattedName = product.productOptions?.length > 0
                ? `${product.productName} (${product.productOptions.join(', ')})`
                : product.productName;

            const productId = await findOrCreateProduct(formattedName, product.unitPrice);

            odooOrderLines.push([
                0, 0, {
                    product_id: productId,
                    name: formattedName,
                    product_uom_qty: product.quantity,
                    price_unit: product.unitPrice
                }
            ]);
        }

        // Step 3: Create and confirm sale order
        const saleOrderId = await createSaleOrder(customerId, odooOrderLines);
        await confirmSaleOrder(saleOrderId);

        res.status(200).json({
            success: true,
            message: 'Order received and processed successfully.',
            saleOrderId,
            productCount: products.length
        });

    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start the webhook server
app.listen(PORT || 3000, () => {
    console.log(`Webhook server listening on port ${PORT || 3000}`);
});