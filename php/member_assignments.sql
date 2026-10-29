SELECT a.*,u.full_name,
    (SELECT up.file_name FROM uploads up WHERE up.assignment_id=a.id ORDER BY up.id DESC LIMIT 1) file_name,
    (SELECT r.status FROM reviews r JOIN uploads up ON up.id=r.upload_id WHERE up.assignment_id=a.id ORDER BY r.id DESC LIMIT 1) review_status,
    (SELECT r.note FROM reviews r JOIN uploads up ON up.id=r.upload_id WHERE up.assignment_id=a.id ORDER BY r.id DESC LIMIT 1) review_note
    FROM assignments a JOIN users u ON u.id=a.user_id JOIN chapters c ON c.id=a.chapter_id JOIN work_access w ON w.series_id=c.series_id WHERE w.user_id=? AND a.active=1