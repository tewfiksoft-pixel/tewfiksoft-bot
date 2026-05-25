import BaseRole from './BaseRole.js';
import AdminRole from './AdminRole.js';
import ManagerRole from './ManagerRole.js';
import ChefDeQuartRole from './ChefDeQuartRole.js';
import GeneralManagerRole from './GeneralManagerRole.js';
import EmployeeRole from './EmployeeRole.js';
import GestionnaireRhRole from './GestionnaireRhRole.js';
import PosteGardeRole from './PosteGardeRole.js';
import ServiceCommercialRole from './ServiceCommercialRole.js';
import FinanceRole from './FinanceRole.js';
import GDSRole from './GDSRole.js';

export default class RoleFactory {
  static create(user) {
    if (!user) return null;
    const role = String(user.role).toLowerCase();
    switch (role) {
      case 'admin': return new AdminRole(user);
      case 'manager': return new ManagerRole(user);
      case 'chef_de_quart': return new ChefDeQuartRole(user);
      case 'general_manager': return new GeneralManagerRole(user);
      case 'employee': return new EmployeeRole(user);
      case 'gestionnaire_rh': return new GestionnaireRhRole(user);
      case 'poste_garde': return new PosteGardeRole(user);
      case 'service_commercial': return new ServiceCommercialRole(user);
      case 'finance': return new FinanceRole(user);
      case 'gds': return new GDSRole(user);
      default: return new BaseRole(user);
    }
  }
}

