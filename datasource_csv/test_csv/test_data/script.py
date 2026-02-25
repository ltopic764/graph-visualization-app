import csv
import random
import os
import datetime

OUTPUT_DIR = "test_data_csv"
NODE_COUNT = 220

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

first_names = ["Marko", "Jovan", "Ana", "Milica", "Petar", "Ivana", "Dejan", "Sonja", "Luka", "Sofija", "Nikola",
               "Tamara", "Stefan", "Jelena", "Vladimir", "Katarina", "Dusan", "Marija", "Aleksandar", "Nina"]
last_names = ["Petrovic", "Jovanovic", "Nikolic", "Markovic", "Djordjevic", "Stojanovic", "Ilic", "Simic", "Pavlovic",
              "Kostic", "Ristic", "Popovic", "Zivkovic", "Todorovic", "Jankovic"]
cities = ["Beograd", "Novi Sad", "Nis", "Kragujevac", "Subotica", "Zrenjanin", "Cacak", "Uzice", "Pancevo", "Krusevac",
          "Remote"]
departments = ["Engineering", "HR", "Sales", "Marketing", "Finance", "Legal", "Operations", "Product"]


def get_name():
    return f"{random.choice(first_names)} {random.choice(last_names)}"


def get_date():
    start_date = datetime.date(2020, 1, 1)
    end_date = datetime.date(2024, 1, 1)
    delta = end_date - start_date
    random_days = random.randrange(delta.days)
    return (start_date + datetime.timedelta(days=random_days)).isoformat()


print(f"Generating acyclic graph CSV ({NODE_COUNT} nodes)...")

acyclic_rows = []
# Header
acyclic_rows.append(["id", "name", "role", "salary", "department", "city", "hired_at", "reports_to_id"])

acyclic_rows.append(["emp_1", get_name(), "CEO", "15000.00", "Executive", "Beograd", "2010-05-20", ""])

for i in range(2, 7):
    acyclic_rows.append([
        f"emp_{i}", get_name(), "VP", f"{random.uniform(8000, 12000):.2f}",
        random.choice(departments), random.choice(cities), get_date(), "emp_1"
    ])

for i in range(7, 23):
    parent = f"emp_{random.randint(2, 6)}"
    acyclic_rows.append([
        f"emp_{i}", get_name(), "Director", f"{random.uniform(5000, 8000):.2f}",
        random.choice(departments), random.choice(cities), get_date(), parent
    ])

for i in range(23, 64):
    parent = f"emp_{random.randint(7, 22)}"
    acyclic_rows.append([
        f"emp_{i}", get_name(), "Manager", f"{random.uniform(3000, 5000):.2f}",
        random.choice(departments), random.choice(cities), get_date(), parent
    ])

for i in range(64, NODE_COUNT + 1):
    parent = f"emp_{random.randint(23, 63)}"
    roles = ["Senior Dev", "Junior Dev", "Analyst", "Designer", "Recruiter", "Accountant"]
    acyclic_rows.append([
        f"emp_{i}", get_name(), random.choice(roles), f"{random.uniform(1200, 3000):.2f}",
        random.choice(departments), random.choice(cities), get_date(), parent
    ])

with open(os.path.join(OUTPUT_DIR, "dataset_acyclic.csv"), "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerows(acyclic_rows)

print(f"Generating cyclic graph CSV ({NODE_COUNT} nodes)...")

cyclic_rows = []
cyclic_rows.append(["id", "username", "efficiency_score", "role", "main_skill", "reviewed_by_id", "blocked_by_id"])

all_ids = [f"dev_{i}" for i in range(1, NODE_COUNT + 1)]

for node_id in all_ids:
    name_parts = get_name().lower().split()
    username = f"{name_parts[0]}.{name_parts[1]}"

    others = [x for x in all_ids if x != node_id]

    reviewer = random.choice(others)
    blocker = random.choice(others) if random.random() > 0.3 else ""

    skills = ["Python", "Java", "React", "AWS", "Docker", "SQL", "Rust"]

    cyclic_rows.append([
        node_id,
        username,
        f"{random.uniform(0.5, 5.0):.2f}",
        "Developer",
        random.choice(skills),
        reviewer,  # Edge 1
        blocker  # Edge 2
    ])

with open(os.path.join(OUTPUT_DIR, "dataset_cyclic.csv"), "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerows(cyclic_rows)
