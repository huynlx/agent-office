# Virtual Agent Office 3D

Văn phòng 3D hiển thị công việc Claude Code theo thời gian thực: mỗi vai trò là một nhân vật.
Chỉ dùng Node >= 18 (thư viện chuẩn) và Three.js r128 từ CDN. Không build step.

```bash
npm start        # http://localhost:4747   (đổi cổng: PORT=5000 npm start)
npm test         # node --test
```

Xem thử không cần Claude Code: <http://localhost:4747/?demo=1>

## Cài hook trong 3 bước

1. Chạy `npm start`.
2. Mở `.claude/settings.example.json`, thay `/ABS/PATH/agent-office` bằng đường dẫn tuyệt đối tới thư mục này.
3. Gộp khối `hooks` vào `.claude/settings.json` của dự án (hoặc `~/.claude/settings.json`) mà bạn muốn theo dõi, rồi khởi động lại Claude Code.

Thử tay: `curl -XPOST localhost:4747/event -d '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"App.tsx"}}'` → DEV FE đi tới bàn và ngồi gõ.

## Thêm vai trò
Thêm một mục vào `config/roster.json` rồi tải lại trang. Bàn, ghế, ô pantry, ghế họp tự sinh.
```json
{ "id": "sec", "role": "Security", "shirt": "#ffb3b3", "hair": "#222", "skin": "#f5cfa8", "match": ["security", "\\bsec\\b"] }
```
`match` là regex (không phân biệt hoa thường) so với `agent_type` của subagent. Ví dụ subagent `security-auditor` sẽ vào vai này.
Quy tắc theo tool/đường dẫn nhắm tới các id `dev-fe, dev-be, qc, devops, ba, tech-lead`; thiếu id nào thì rơi về `tech-lead`, rồi người đầu tiên.

## Tắt
Dừng server (Ctrl+C). Hook tự im lặng khi server tắt (timeout 500ms). Muốn gỡ hẳn: xoá khối hook khỏi settings.

## Quy tắc ánh xạ (server/mapper.js)
- Subagent: khớp `agent_type` với `match`; tool chạy trong subagent tính cho vai đó.
- Tool: Edit/Write theo đường dẫn: Devops (`Dockerfile`, `.github/`, `*.yml`) → QC (`test`/`spec` đứng riêng trong tên file, hoặc thư mục `test(s)/`) → BA (`*.md`, `docs/`) → BE (`*.sql`, `server/`, `api/`) → FE (`tsx jsx css scss html`). Read/Grep/Glob → BA. Bash `git` → Tech Lead, `docker/kubectl/terraform/helm` → Devops. Còn lại → Tech Lead.
- PreToolUse → working ("Edit App.tsx"); PostToolUse + 8s im lặng → idle; Notification → waiting (agent hoạt động gần nhất); Stop → tất cả idle.
- Riêng tư: `hooks/send.js` chỉ gửi tên tool, đường dẫn file và từ đầu của lệnh. Không gửi nội dung file/prompt. Server bind `127.0.0.1`, từ chối body > 64KB và Host lạ.

## Các quyết định đơn giản hoá
- `test`/`spec` khớp theo ranh giới từ (để `latest/App.tsx` không bị tính là QC), nên hơi khác `*test*` nguyên văn.
- Một tool chạy lâu hơn 8s thì không bị về idle (chỉ PostToolUse mới hẹn giờ); `Stop` sẽ dọn.
- Notification không nói agent nào, nên gán cho agent vừa hoạt động gần nhất.
- Đổi ý giữa đường (ví dụ working → idle khi đang đi) thì nhân vật quay lại theo đường cũ; đổi sang đích khác thì đi hết đoạn hiện tại rồi mới đi tiếp.
- Trên hành lang dùng làn riêng theo chỉ số để giảm chồng nhau; ô đứng/ngồi cuối cùng luôn cố định theo chỉ số.
- Cần Internet để tải Three.js (cdnjs, dự phòng jsdelivr).
