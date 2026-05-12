      const request = {
        id: reqId,
        type: 'exit_auth',
        empId: st.empId,
        empName,
        managerId: st.data.managerId,
        managerName: st.data.managerName,
        exitType: st.data.type,
        reason: st.data.reason,
        exitTime: st.data.exitTime,
        status: 'pending_admin',
        createdAt: new Date().toISOString()
      };
