import uuid
import datetime
from sqlalchemy import create_engine, Column, String, Float, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "sqlite:///./anamnesis.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class DBEvent(Base):
    __tablename__ = "events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_run_id = Column(String, nullable=False, default="demo-agent-1")
    event_type = Column(String, nullable=False)
    summary = Column(String, nullable=False)
    confidence = Column(Float, nullable=True)
    memory_ids_used = Column(Text, nullable=True) # JSON array string e.g. '["id1", "id2"]'
    memory_ids_created = Column(Text, nullable=True) # JSON array string
    chosen_option = Column(Text, nullable=True)
    rejected_alternatives = Column(Text, nullable=True) # JSON array of objects string
    contradiction_flag = Column(Boolean, default=False)
    occurred_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class DBQASession(Base):
    __tablename__ = "qa_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    question = Column(String, nullable=False)
    answer = Column(String, nullable=False)
    cited_memory_ids = Column(Text, nullable=True) # JSON array string
    question_type = Column(String, nullable=True) # 'general' | 'comparison'
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

def init_db():
    Base.metadata.create_all(bind=engine)
