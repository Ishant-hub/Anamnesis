from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime

class RejectedAlternative(BaseModel):
    name: str
    confidence: float
    rejection_reason: str
    citing_memory_ids: Optional[List[str]] = []

class EventBase(BaseModel):
    agent_run_id: str = "demo-agent-1"
    event_type: str
    summary: str
    confidence: Optional[float] = None
    memory_ids_used: Optional[List[str]] = []
    memory_ids_created: Optional[List[str]] = []
    chosen_option: Optional[str] = None
    rejected_alternatives: Optional[List[RejectedAlternative]] = []
    contradiction_flag: bool = False
    occurred_at: datetime

class EventCreate(EventBase):
    pass

class EventResponse(EventBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True

class QASessionBase(BaseModel):
    question: str
    answer: str
    cited_memory_ids: Optional[List[str]] = []
    question_type: Optional[str] = None # 'general' | 'comparison'

class QASessionCreate(QASessionBase):
    pass

class QASessionResponse(QASessionBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True
