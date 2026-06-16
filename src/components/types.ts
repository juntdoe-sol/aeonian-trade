// Shared type definitions

export interface User {
  address: string;
  provider: any;
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}
