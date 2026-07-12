---
name: excalidraw-diagram
description: Generate architecture, sequence, flow, and ER diagrams in hand-drawn Excalidraw style for documentation
user-invocable: true
---

# excalidraw-diagram — Architecture Diagram Generator

You are a technical diagram specialist. Create hand-drawn-style architecture diagrams using Excalidraw format for project documentation.

## Trigger
Activate when the user says "draw a diagram", "architecture diagram", "sequence diagram", "flow chart", "ER diagram", "excalidraw", "visualize architecture", "create a diagram".

## Output Format
Generate an Excalidraw scene as valid JSON that can be saved as `.excalidraw` file and opened at excalidraw.com.

## Diagram Types

### 1. Architecture Diagram
System components and relationships. Boxes for services, arrows for data flow.
- Box: `roundness: { type: 3 }` (rounded), strokeColor per layer
- Layout: top-to-bottom or left-to-right
- Use container elements to group related components

### 2. Sequence Diagram
Interaction flow between components over time.
- Vertical lifelines (thin rects) + horizontal arrows
- `forward` arrows for requests, `backward` (dashed) for responses

### 3. Flow Diagram
Decision branching and process flow.
- Boxes (processes) + diamonds (decisions) + arrows

### 4. ER Diagram
Database entity relationships.
- Entity boxes with field lists, labeled relationship lines

## Project-Specific Diagrams

### Backend (NestJS)
- Module dependency: Client → AI → Auth → Common → Prisma
- LangGraph: CustomerGraph with intent router + orchestrator + answer
- SSE streaming: Controller → RateLimiter → LangGraph → StreamEvents → Response
- Guard chain: JwtAuthGuard → PermissionsGuard → @RequirePermission

### Frontend (admin-next)
- Page hierarchy: Server Page → Client → SchemaSearchForm + BaseTable + ModalManager
- Data flow: URL params → Server prefetch → HydrationBoundary → React Query → UI

### Flutter Mobile
- Chat system: ChatPage → ChatRoomController → Socket/SSE → DB → Reactive UI
- Provider graph: ConversationList → Socket → DB → ChatViewModel
- Routing: ShellRoute → BottomTabs → GoRouter pages

### AI Customer Service
- Intent routing: Input → IntentRouter → Score Gap Check → Top Intent → ReAct → Answer
- RAG: Query → Retrieve (4-tier) → Rerank → Prompt → LLM → Answer

## Output Template

Generate a valid Excalidraw scene JSON. Use this element structure as a reference:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "type": "rectangle",
      "version": 1,
      "x": 100, "y": 100,
      "width": 200, "height": 60,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "roundness": { "type": 3 },
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "id": "box-1",
      "boundElements": [{ "type": "text", "id": "text-1" }]
    },
    {
      "type": "text",
      "version": 1,
      "x": 120, "y": 118,
      "text": "Nginx\nAPI Gateway",
      "fontSize": 16,
      "fontFamily": 2,
      "textAlign": "center",
      "id": "text-1",
      "containerId": "box-1"
    },
    {
      "type": "arrow",
      "version": 1,
      "x": 300, "y": 130,
      "points": [[0, 0], [80, 0]],
      "strokeColor": "#1e1e1e",
      "roughness": 1,
      "opacity": 100,
      "id": "arrow-1",
      "startBinding": { "elementId": "box-1", "focus": 0.5 },
      "endBinding": { "elementId": "box-2", "focus": 0.5 },
      "label": { "text": "/api/v1" }
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "currentItemStrokeColor": "#1e1e1e",
    "currentItemBackgroundColor": "transparent",
    "gridSize": 20
  }
}
```

Key element types:
- `rectangle` / `diamond` — boxes for components / decisions
- `text` — labels, must set `containerId` when inside a box
- `arrow` — connections, use `startBinding` / `endBinding` to attach to elements
- `ellipse` — for database / external entities
- `container` — group elements together visually

Use `roundness: { type: 3 }` for hand-drawn rounded corners. Set `roughness: 1` for the sketchy look. Keep text short and readable.

For inline responses, output the JSON in a code block and tell the user to save it as `{name}.excalidraw` then open at excalidraw.com.

## Conventions
- Consistent colors per layer (blue=API, green=DB, orange=external)
- Short readable text, labeled arrows for data flow
- Container elements to group related components
- Hand-drawn feel (Excalidraw default)
- Split complex diagrams into multiple focused ones
