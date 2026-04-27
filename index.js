  if (user.role === 'general_manager' || user.role === 'admin' || user.role === 'manager') return (db.hr_employees||[]).filter(e=>e.status==='active');
