const rawRequest = {
  // ... (your full JSON object)
  "q54_myProduct": {
    // ... other keys
    "products": [
      {
        "productName": "Organic Chai Latte 1kg",
        "unitPrice": 10,
        "currency": "USD",
        "quantity": 1,
        "subTotal": 10,
        "productOptions": [
          "Amount: 10 USD",
          "Quantity: 1"
        ]
      },
      {
        "productName": "Organic Chai Latte 250g",
        "unitPrice": 20,
        "currency": "USD",
        "quantity": 1,
        "subTotal": 20,
        "productOptions": [
          "Amount: 20 USD",
          "Quantity: 1"
        ]
      },
      // ... rest of products
    ],
    "totalInfo": {
      "totalSum": 223,
      "currency": "USD"
    }
  }
};

const productsArray = rawRequest.q54_myProduct.products;

console.log(productsArray);
