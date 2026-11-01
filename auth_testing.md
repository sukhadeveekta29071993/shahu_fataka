# Auth Testing Playbook — CrackerPOS

Step 1: MongoDB Verification
```
mongosh
use test_database
db.users.find({role: "admin"}).pretty()
db.users.findOne({role: "admin"}, {password_hash: 1})
```
Verify: bcrypt hash starts with `$2b$`, unique index on users.email, index on login_attempts.identifier.

Step 2: API Testing
```
curl -c cookies.txt -X POST http://localhost:8001/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@crackerpos.in","password":"admin123"}'
cat cookies.txt
curl -b cookies.txt http://localhost:8001/api/auth/me
```

Login should return the user object and set `access_token` + `refresh_token` cookies. The `/me` call should return the same user using those cookies.

Extra endpoints:
- POST /api/auth/register {name,email,password,phone,customer_type,business_name,gstin}
- GET /api/products?category=&q=
- POST /api/orders {items:[{product_id,qty}], payment_mode, utr}
- GET /api/orders, GET /api/orders/{id}
