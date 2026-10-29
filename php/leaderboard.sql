SELECT u.id userId,u.full_name fullName,COUNT(*) total,
        SUM(CASE WHEN c.stage='translation' THEN 1 ELSE 0 END) translation,
        SUM(CASE WHEN c.stage='clean' THEN 1 ELSE 0 END) clean,
        SUM(CASE WHEN c.stage='typing' THEN 1 ELSE 0 END) typing
        FROM stage_completions c JOIN users u ON u.id=c.user_id JOIN stages st ON st.chapter_id=c.chapter_id AND st.stage=c.stage
        WHERE u.active=1 AND st.status='completed' AND c.completed_at>=? AND c.completed_at<?
        GROUP BY u.id ORDER BY total DESC,u.full_name COLLATE NOCASE,u.id LIMIT 5