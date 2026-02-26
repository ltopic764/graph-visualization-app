import json
import csv
import os
import random

os.makedirs("test_data", exist_ok=True)

# ============================================================
# 1. JSON – acyclic graph
# ============================================================

def generate_acyclic_json():
    employees = []
    emp_id = 1

    # CEO
    ceo_id = str(emp_id)
    emp_id += 1

    directors = []
    for d in range(5):
        dir_id = str(emp_id)
        emp_id += 1

        managers = []
        for m in range(5):
            mgr_id = str(emp_id)
            emp_id += 1

            workers = []
            for w in range(8):
                worker = {
                    "id": str(emp_id),
                    "name": f"Worker_{emp_id}",
                    "age": random.randint(22, 55),
                    "salary": float(random.randint(30000, 70000)),
                    "hired": f"202{random.randint(0,3)}-0{random.randint(1,9)}-15"
                }
                workers.append(worker)
                emp_id += 1

            manager = {
                "id": mgr_id,
                "name": f"Manager_{mgr_id}",
                "age": random.randint(30, 50),
                "salary": float(random.randint(60000, 90000)),
                "hired": f"201{random.randint(5,9)}-0{random.randint(1,9)}-10",
                "team": workers
            }
            managers.append(manager)

        director = {
            "id": dir_id,
            "name": f"Director_{dir_id}",
            "age": random.randint(40, 60),
            "salary": float(random.randint(90000, 130000)),
            "hired": f"201{random.randint(0,4)}-0{random.randint(1,9)}-01",
            "department": managers
        }
        directors.append(director)

    ceo = {
        "id": ceo_id,
        "name": "CEO_Alice",
        "age": 55,
        "salary": 200000.0,
        "hired": "2010-01-01",
        "reports_to": directors
    }

    with open("test_data/company_acyclic.json", "w", encoding="utf-8") as f:
        json.dump(ceo, f, indent=2)

    print(f"Generated company_acyclic.json – about {emp_id - 1} nodes")

# ============================================================
# 2. JSON – cyclic graf
# ============================================================

def generate_cyclic_json():
    people = []
    n = 220

    for i in range(1, n + 1):
        people.append({
            "id": str(i),
            "name": f"Person_{i}",
            "age": random.randint(18, 65),
            "city": random.choice(["Sarajevo", "Beograd", "Zagreb", "Ljubljana"]),
            "score": round(random.uniform(1.0, 10.0), 2)
        })

    for person in people:
        pid = int(person["id"])

        friend1 = str((pid % n) + 1)
        friend2 = str(((pid - 2) % n) + 1)

        person["best_friend"] = friend1
        person["also_knows"]  = friend2

    with open("test_data/social_cyclic.json", "w", encoding="utf-8") as f:
        json.dump(people, f, indent=2)

    print(f"Generated social_cyclic.json – {n} nodes")

# ============================================================
# 3. CSV – acyclic graf
# ============================================================

def generate_acyclic_csv():
    cities = [
        "Sarajevo", "Beograd", "Zagreb", "Ljubljana", "Podgorica",
        "Skoplje", "Tirana", "Pristina", "Novi_Sad", "Banja_Luka",
        "Mostar", "Tuzla", "Zenica", "Nish", "Subotica",
        "Rijeka", "Split", "Dubrovnik", "Osijek", "Varazdin"
    ]

    extra = [f"City_{i}" for i in range(1, 210)]
    all_cities = cities + extra

    edges = []
    seen_pairs = set()

    for i, city in enumerate(all_cities):
        for j in range(1, 3):
            target_idx = (i + j) % len(all_cities)
            src = city
            dst = all_cities[target_idx]

            pair = (src, dst)
            reverse = (dst, src)

            if pair not in seen_pairs and reverse not in seen_pairs:
                seen_pairs.add(pair)
                edges.append({
                    "source": src,
                    "target": dst,
                    "weight": round(random.uniform(50, 500), 1),
                    "directed": "True",
                    "road_type": random.choice(["highway", "regional", "local"])
                })

    with open("test_data/roads_acyclic.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["source", "target", "weight", "directed", "road_type"])
        writer.writeheader()
        writer.writerows(edges)

    print(f"Generated roads_acyclic.csv – {len(all_cities)} cities")

# ============================================================
# 4. CSV – cyclic graf
# ============================================================

def generate_cyclic_csv():
    n = 220
    rows = []

    for i in range(1, n + 1):
        next_pc  = str((i % n) + 1)
        prev_pc  = str(((i - 2) % n) + 1)

        rows.append({
            "id":        str(i),
            "name":      f"PC_{i}",
            "ip":        f"192.168.{i // 255}.{i % 255}",
            "os":        random.choice(["Windows", "Linux", "MacOS"]),
            "ram_gb":    random.choice([8, 16, 32, 64]),
            "connects_to": next_pc,
            "backup_to":   prev_pc,
        })

    with open("test_data/network_cyclic.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "name", "ip", "os", "ram_gb", "connects_to", "backup_to"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated network_cyclic.csv – {n} nodes")


generate_acyclic_json()
generate_cyclic_json()
generate_acyclic_csv()
generate_cyclic_csv()

print("\nAll test files in test_data/")