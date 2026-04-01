export class StorageManager {
  static getAppNamespace() {
    return 'app1'; // Change this to a unique identifier for each app
  }

  static save(key, data) {
    try {
      const namespacedKey = `${this.getAppNamespace()}_${key}`;
      localStorage.setItem(namespacedKey, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Storage save failed:', error);
      return false;
    }
  }

  static load(key, defaultValue = null) {
    try {
      const namespacedKey = `${this.getAppNamespace()}_${key}`;
      const data = localStorage.getItem(namespacedKey);
      return data ? JSON.parse(data) : defaultValue;
    } catch (error) {
      console.error('Storage load failed:', error);
      return defaultValue;
    }
  }
}
