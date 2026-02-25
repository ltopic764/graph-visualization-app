import json
import random
import os
import datetime

OUTPUT_DIR = "test_data_json"
NODE_COUNT = 220

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

tech_stacks = ["Python/Django", "Java/Spring", "React/Node", "Go/Gin", "Rust", "C#/.NET", "AWS/Lambda"]
statuses = ["To Do", "In Progress", "Code Review", "Done", "Blocked", "Backlog"]
server_types = ["Load Balancer", "Database", "Cache", "Microservice", "Frontend", "Worker", "Gateway"]
regions = ["us-east-1", "eu-central-1", "ap-northeast-1", "sa-east-1"]


def get_date():
    start = datetime.date(2023, 1, 1)
    end = datetime.date(2024, 1, 1)
    return (start + datetime.timedelta(days=random.randrange((end - start).days))).isoformat()


print(f"Generating acyclic JSON ({NODE_COUNT} nodes)...")

nodes_ac = []
edges_ac = []
edge_counter = 0

queue = []

# Root node
root_id = "comp_1"
nodes_ac.append({
    "id": root_id,
    "label": "Company Portfolio",
    "type": "Portfolio",
    "budget": 5000000,
    "owner": "CTO"
})
queue.append(root_id)

current_id = 1

while len(nodes_ac) < NODE_COUNT:
    if not queue:
        break

    parent_id = queue.pop(0)

    num_children = random.randint(2, 5)

    for _ in range(num_children):
        if len(nodes_ac) >= NODE_COUNT:
            break

        current_id += 1
        child_id = f"item_{current_id}"

        node_data = {
            "id": child_id,
            "label": f"Work Item {current_id}",
            "status": random.choice(statuses),
            "priority": random.choice(["Low", "Medium", "High", "Critical"]),
            "due_date": get_date(),
            "assignee": f"Dev_{random.randint(1, 50)}"
        }

        nodes_ac.append(node_data)
        queue.append(child_id)

        edge_counter += 1
        edges_ac.append({
            "id": f"e_{edge_counter}",
            "source": parent_id,
            "target": child_id,
            "directed": True,
            "type": "contains",
            "weight": 1.0
        })

graph_acyclic = {"nodes": nodes_ac, "edges": edges_ac}

with open(os.path.join(OUTPUT_DIR, "graph_220_acyclic.json"), "w", encoding="utf-8") as f:
    json.dump(graph_acyclic, f, indent=2)

print(f"Generating cyclic JSON ({NODE_COUNT} nodes)...")

nodes_cy = []
edges_cy = []
edge_counter = 0

for i in range(1, NODE_COUNT + 1):
    node_id = f"srv_{i}"
    s_type = random.choice(server_types)

    nodes_cy.append({
        "id": node_id,
        "label": f"{s_type}-{i:03d}",
        "type": s_type,
        "ip": f"192.168.1.{i}",
        "region": random.choice(regions),
        "uptime": f"{random.uniform(99.0, 99.99):.2f}%",
        "load": random.randint(10, 95)
    })

for i in range(NODE_COUNT):
    source = nodes_cy[i]["id"]
    target = nodes_cy[(i + 1) % NODE_COUNT]["id"]

    edge_counter += 1
    edges_cy.append({
        "id": f"conn_{edge_counter}",
        "source": source,
        "target": target,
        "directed": True,
        "type": "backbone_link",
        "latency": f"{random.randint(1, 5)}ms"
    })

for _ in range(NODE_COUNT // 2):
    src = random.choice(nodes_cy)["id"]
    tgt = random.choice(nodes_cy)["id"]

    if src != tgt:
        edge_counter += 1
        edges_cy.append({
            "id": f"conn_{edge_counter}",
            "source": src,
            "target": tgt,
            "directed": True,
            "type": "api_call",
            "latency": f"{random.randint(20, 150)}ms"
        })

graph_cyclic = {"nodes": nodes_cy, "edges": edges_cy}

with open(os.path.join(OUTPUT_DIR, "graph_220_cyclic.json"), "w", encoding="utf-8") as f:
    json.dump(graph_cyclic, f, indent=2)
