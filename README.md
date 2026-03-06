# Graph Visualization App

Graph Visualization App is a modular Django-based project for loading graph data (CSV/JSON) and rendering it with pluggable visualizers.

## Authors

- Student1 - Nikola Ribic SV41/2023
- student2 - Lazar Topic SV62/2023
- student3 - Pavle Maksimovic SV58/2023
- student4 - Drazen Bozic SV56/2023

## Project Structure

- `graph_explorer/` - Django project (`manage.py`, web settings, explorer app, static files/templates)
- `api/` - Core graph domain/API package (`graph_api`)
- `core/` - Platform core/registry/workspace package (`graph_platform`)
- `datasource_json/` - JSON datasource plugin
- `datasource_csv/` - CSV datasource plugin
- `visualizer_simple/` - Simple visualizer plugin
- `visualizer_block/` - Block visualizer plugin
- `requirements.txt` - Editable installs for local packages + shared dependency baseline

## Prerequisites

- Python 3.11+ (package metadata requires `>=3.11`)
- `pip`

## First-Time Setup (Fresh Machine After Clone)

Run these commands from a terminal:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install Django
cd graph_explorer
python manage.py migrate
python manage.py runserver
```

Then open: `http://127.0.0.1:8000/`

## Later Runs (Environment Already Set Up)

Use the shorter startup flow:

```bash
source .venv/bin/activate
cd graph_explorer
python manage.py runserver
```

## Dependency Notes

- `pip install -r requirements.txt` installs local project packages in editable mode (`api`, `core`, datasource plugins, visualizer plugins) and `jinja2`.
- Django is installed separately via `pip install Django`.
- If you pull new changes that add or update database migrations, run:

```bash
source .venv/bin/activate
cd graph_explorer
python manage.py migrate
```

