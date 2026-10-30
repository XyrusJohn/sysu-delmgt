import React from "react";
import { useUser } from "../hooks/useUser";

/**
 * UserHeader Component
 * Displays the logged-in user's profile summary and logout action.
 */
const UserHeader = () => {
  const { user, logout } = useUser();

  if (!user) return null;

  const name = user.displayName || user.username || "User";
  const initial = name[0].toUpperCase();
  const roleText = user.role
    ? user.role.replace(/_/g, " ").toUpperCase()
    : "USER";

  return (
    <header className="h-16 border-b border-db-border bg-db-panel/50 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 group cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-sysu-red/20 border border-sysu-red/30 flex items-center justify-center text-sysu-red font-bold text-sm overflow-hidden">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              initial
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-db-text leading-none">
              {name}
            </span>
            <span className="text-[10px] font-bold text-db-text3 uppercase tracking-wider">
              {roleText}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={logout}
          className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-db-text3 hover:text-sysu-red border border-db-border hover:border-sysu-red/40 rounded-lg transition-all bg-db-bg"
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default UserHeader;
