import asyncio, random
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
load_dotenv('.env')

async def run():
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]
    products = await db.products.find({"barcode": {"$exists": False}}).to_list(1000)
    count = 0
    for p in products:
        barcode = "890" + "".join([str(random.randint(0, 9)) for _ in range(9)])
        await db.products.update_one({"_id": p["_id"]}, {"$set": {"barcode": barcode}})
        count += 1
    # Also fix empty barcodes
    products2 = await db.products.find({"barcode": ""}).to_list(1000)
    for p in products2:
        barcode = "890" + "".join([str(random.randint(0, 9)) for _ in range(9)])
        await db.products.update_one({"_id": p["_id"]}, {"$set": {"barcode": barcode}})
        count += 1
    print(f"Generated barcodes for {count} products")

asyncio.run(run())
