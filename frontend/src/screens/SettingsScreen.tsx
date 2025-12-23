import { useState } from "react";
import type { ReactNode } from "react";

type SettingsCategory = "account" | "privacy" | "chats" | "notifications" | "shortcuts" | "help" | "logout";

interface SettingsItem {
    id: SettingsCategory;
    label: string;
    icon: ReactNode;
    danger?: boolean;
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
    const [selectedCategory, setSelectedCategory] = useState<SettingsCategory | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    const settingsItems: SettingsItem[] = [
        {
            id: "account",
            label: "Account",
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12.001 7.5c-2.482 0-4.501 2.018-4.501 4.5 0 2.481 2.019 4.5 4.501 4.5 2.482 0 4.501-2.019 4.501-4.5 0-2.482-2.019-4.5-4.501-4.5zM12 15c-1.654 0-3-1.346-3-3s1.346-3 3-3 3 1.346 3 3-1.346 3-3 3zm8.84-6.626c-.801-.129-1.519-.606-1.938-1.293l-1.396-2.289c-.457-.75-1.238-1.217-2.116-1.266-.879-.05-1.717.331-2.272 1.033l-1.534 1.94c-.555.702-1.466 1.007-2.313.775l-2.616-.717c-.846-.232-1.742.063-2.428.799-.686.735-.923 1.766-.642 2.793l.869 3.176c.281 1.027-.055 2.104-.854 2.734l-2.467 1.946c-.8.631-1.16 1.666-.977 2.804.184 1.138.908 2.077 1.962 2.546l3.256 1.449c1.054.47 1.816 1.434 1.935 2.449l.367 3.138c.119 1.015.838 1.862 1.949 2.296 1.111.435 2.363.166 3.395-.729l2.854-2.476c.923-.801 2.248-.954 3.364-.389l3.447 1.749c1.116.566 2.434.366 3.572-.541 1.139-.908 1.613-2.364 1.286-3.949l-.563-2.729c-.182-.883.188-1.788.939-2.299l2.32-1.579c.751-.511 1.121-1.416 1.004-2.453-.118-1.037-.723-1.915-1.641-2.381l-2.836-1.439c-.918-.466-1.583-1.344-1.688-2.23l-.324-2.769c-.105-.886-.66-1.623-1.505-1.998zM12 19c-3.859 0-7-3.141-7-7s3.141-7 7-7 7 3.141 7 7-3.141 7-7 7z"></path>
                </svg>
            )
        },
        {
            id: "privacy",
            label: "Privacy",
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12 2C9.243 2 7 4.243 7 7v3H6c-1.103 0-2 .897-2 2v8c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2v-8c0-1.103-.897-2-2-2h-1V7c0-2.757-2.243-5-5-5zm6 10v8H6v-8h12zm-9-2V7c0-1.654 1.346-3 3-3s3 1.346 3 3v3H9z"></path>
                </svg>
            )
        },
        {
            id: "chats",
            label: "Chats",
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M20 2H4c-1.103 0-2 .897-2 2v18l5.333-4H20c1.103 0 2-.897 2-2V4c0-1.103-.897-2-2-2zm0 14H6.667L4 18V4h16v12z"></path>
                </svg>
            )
        },
        {
            id: "notifications",
            label: "Notifications",
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12 22a2.98 2.98 0 0 0 2.818-2H9.182A2.98 2.98 0 0 0 12 22zm7-7.414V10c0-3.217-2.185-5.927-5.145-6.742C13.562 2.52 12.846 2 12 2s-1.562.52-1.855 1.258C7.185 4.074 5 6.783 5 10v4.586l-1.707 1.707A.996.996 0 0 0 3 17v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-1a.996.996 0 0 0-.293-.707L19 14.586zM17 17H7v-7c0-2.757 2.243-5 5-5s5 2.243 5 5v7z"></path>
                </svg>
            )
        },
        {
            id: "shortcuts",
            label: "Keyboard shortcuts",
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M20 4H4c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V6c0-1.103-.897-2-2-2zM4 18V6h16l.002 12H4z"></path>
                    <path d="M6 8h2v2H6zm0 4h2v2H6zm4-4h2v2h-2zm0 4h2v2h-2zm4-4h2v2h-2zm0 4h2v2h-2zm4-4h2v2h-2zm0 4h2v2h-2z"></path>
                </svg>
            )
        },
        {
            id: "help",
            label: "Help and feedback",
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z"></path>
                    <path d="M11 11h2v6h-2zm0-4h2v2h-2z"></path>
                </svg>
            )
        },
        {
            id: "logout",
            label: "Log out",
            danger: true,
            icon: (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M16 13v-2H7V8l-5 4 5 4v-3z"></path>
                    <path d="M20 3h-9c-1.103 0-2 .897-2 2v4h2V5h9v14h-9v-4H9v4c0 1.103.897 2 2 2h9c1.103 0 2-.897 2-2V5c0-1.103-.897-2-2-2z"></path>
                </svg>
            )
        }
    ];

    const filteredItems = settingsItems.filter(item => 
        item.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex h-screen bg-light-secondary dark:bg-black overflow-hidden">
            {/* Sidebar */}
            <div className="w-[400px] flex flex-col border-r border-gray-200 dark:border-dark-tertiary bg-white dark:bg-black">
                {/* Header */}
                <div className="h-28 flex flex-col justify-end px-4 pb-2">
                    <div className="flex items-center mb-4">
                        <button onClick={onBack} className="mr-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                <path d="M21 11H6.414l5.293-5.293-1.414-1.414L2.586 12l7.707 7.707 1.414-1.414L6.414 13H21z"></path>
                            </svg>
                        </button>
                        <h1 className="text-2xl font-semibold text-light-text dark:text-dark-text">Settings</h1>
                    </div>
                    
                    {/* Search */}
                    <div className="bg-light-secondary dark:bg-dark-tertiary rounded-lg flex items-center px-4 py-2">
                        <svg viewBox="0 0 24 24" width="20" height="20" className="text-gray-500 dark:text-gray-400 mr-4" fill="currentColor">
                            <path d="M10 18a7.952 7.952 0 0 0 4.897-1.688l4.396 4.396 1.414-1.414-4.396-4.396A7.952 7.952 0 0 0 18 10c0-4.411-3.589-8-8-8s-8 3.589-8 8 3.589 8 8 8zm0-14c3.309 0 6 2.691 6 6s-2.691 6-6 6-6-2.691-6-6 2.691-6 6-6z"></path>
                        </svg>
                        <input 
                            type="text" 
                            placeholder="Search settings" 
                            className="bg-transparent border-none outline-none text-sm w-full text-light-text dark:text-dark-text placeholder-gray-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* User Profile */}
                <div className="px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary cursor-pointer flex items-center">
                    <div className="w-12 h-12 rounded-full overflow-hidden mr-4">
                        <img src="https://github.com/gunit.png" alt="Profile" className="w-full h-full object-cover" />
                    </div>
                    <div>
                        <h3 className="text-light-text dark:text-dark-text font-medium">Gunit Kumar</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Available</p>
                    </div>
                </div>

                {/* Settings List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredItems.map((item) => (
                        <div 
                            key={item.id}
                            onClick={() => setSelectedCategory(item.id)}
                            className={`flex items-center px-4 py-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-dark-tertiary ${selectedCategory === item.id ? 'bg-gray-200 dark:bg-[#2a2a2a]' : ''}`}
                        >
                            <div className={`mr-6 ${item.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                                {item.icon}
                            </div>
                            <div className="flex-1 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
                                <h3 className={`font-medium ${item.danger ? 'text-red-500' : 'text-light-text dark:text-dark-text'}`}>{item.label}</h3>
                                {item.id === "account" && <p className="text-sm text-gray-500 dark:text-gray-400">Security notifications, account info</p>}
                                {item.id === "privacy" && <p className="text-sm text-gray-500 dark:text-gray-400">Blocked contacts, disappearing messages</p>}
                                {item.id === "chats" && <p className="text-sm text-gray-500 dark:text-gray-400">Theme, wallpaper, chat settings</p>}
                                {item.id === "notifications" && <p className="text-sm text-gray-500 dark:text-gray-400">Messages, groups, sounds</p>}
                                {item.id === "shortcuts" && <p className="text-sm text-gray-500 dark:text-gray-400">Quick actions</p>}
                                {item.id === "help" && <p className="text-sm text-gray-500 dark:text-gray-400">Help centre, contact us, privacy policy</p>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 bg-light-secondary dark:bg-dark-secondary flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                {selectedCategory ? (
                    <div className="text-center">
                        <h2 className="text-2xl font-light mb-4">
                            {settingsItems.find(i => i.id === selectedCategory)?.label}
                        </h2>
                        <p>Settings content for {selectedCategory} would go here.</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center">
                        <div className="w-32 h-32 mb-8 text-gray-300 dark:text-[#2a2a2a]">
                            <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
                                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84a.484.484 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L2.09 8.83a.488.488 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.488.488 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.27.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.488.488 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"></path>
                            </svg>
                        </div>
                        <h2 className="text-2xl font-light">Settings</h2>
                    </div>
                )}
            </div>
        </div>
    );
}
