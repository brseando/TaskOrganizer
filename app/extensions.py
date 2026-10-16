"""Shared Flask extension instances.

Kept in their own module so `models.py` and `routes.py` can both import
`db` without creating a circular import with the app factory in
`__init__.py`.
"""
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
