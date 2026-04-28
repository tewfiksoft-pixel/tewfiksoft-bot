import BaseRole from './BaseRole.js';
import AdminRole from './AdminRole.js';
import ManagerRole from './ManagerRole.js';
import GeneralManagerRole from './GeneralManagerRole.js';
import EmployeeRole from './EmployeeRole.js';
import GestionnaireRhRole from './GestionnaireRhRole.js';

export default class RoleFactory {
  static create(user) {
    if (!user) return null;
    const role = String(user.role).toLowerCase();
    switch (role) {
      case 'admin': return new AdminRole(user);
      case 'manager': return new ManagerRole(user);
      case 'general_manager': return new GeneralManagerRole(user);
      case 'employee': return new EmployeeRole(user);
      case 'gestionnaire_rh': return new GestionnaireRhRole(user);
      default: return new BaseRole(user);
    }
  }
}
