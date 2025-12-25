import { useEffect, useState } from "react";
import { GetChatList } from "../../wailsjs/go/api/Api";
import { api } from "../../wailsjs/go/models";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { ChatDetail } from "./ChatDetail";

type ChatItem = {
    id: string;
    name: string;
    subtitle: string;
    type: 'group' | 'contact';
    timestamp?: number;
    avatar?: string;
};

export function ChatListScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
    const [chats, setChats] = useState<ChatItem[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [selectedChatName, setSelectedChatName] = useState<string>("");
    const [selectedChatAvatar, setSelectedChatAvatar] = useState<string | undefined>(undefined);

    const handleChatSelect = (chat: ChatItem) => {
        setSelectedChatId(chat.id);
        setSelectedChatName(chat.name);
        setSelectedChatAvatar(chat.avatar);
    };

    const handleBack = () => {
        setSelectedChatId(null);
        setSelectedChatName("");
        setSelectedChatAvatar(undefined);
    };

    const fetchChats = () => {
        GetChatList()
            .then((chatElements) => {
                const items: ChatItem[] = (chatElements || []).map((c: api.ChatElement) => {
                    const isGroup = c.jid.endsWith('@g.us');
                    return {
                        id: c.jid,
                        name: c.full_name || c.push_name || c.short || c.jid,
                        subtitle: c.latest_message || "",
                        type: isGroup ? 'group' : 'contact',
                        avatar: c.avatar_url
                    };
                });
                setChats(items);
            })
            .catch(console.error);
    };

    useEffect(() => {
        const unsub = EventsOn("wa:new_message", () => {
            fetchChats();
        });
    
        return () => {
            unsub();
        };
      }, []);

    useEffect(() => {
        fetchChats();
    }, []);

    const filteredChats = chats.filter(c => 
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex h-screen bg-light-secondary dark:bg-black overflow-hidden">
            {/* Left Sidebar - Chat List */}
            <div className={`${selectedChatId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[400px] border-r border-gray-200 dark:border-[#1a1a1a] bg-white dark:bg-black h-full`}>
                {/* Header */}
                <div className="h-16 bg-light-secondary dark:bg-[#0d0d0d] flex items-center justify-between px-4 border-b border-gray-200 dark:border-[#1a1a1a]">
                    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden">
                        <svg viewBox="0 0 48 48" className="w-full h-full text-white" fill="currentColor">
                                <path d="M24 23q-1.857 0-3.178-1.322Q19.5 20.357 19.5 18.5t1.322-3.178T24 14t3.178 1.322Q28.5 16.643 28.5 18.5t-1.322 3.178T24 23m-6.75 10q-.928 0-1.59-.66-.66-.662-.66-1.59v-.9q0-.956.492-1.758A3.3 3.3 0 0 1 16.8 26.87a16.7 16.7 0 0 1 3.544-1.308q1.8-.435 3.656-.436 1.856 0 3.656.436T31.2 26.87q.816.422 1.308 1.223T33 29.85v.9q0 .928-.66 1.59-.662.66-1.59.66z" />
                            </svg>
                    </div>
                    <div className="flex gap-4 text-gray-500 dark:text-gray-400">
                        <button title="New Chat">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19.005 3.175H4.674C3.642 3.175 3 3.789 3 4.821V21.02l3.544-3.514h12.461c1.033 0 2.064-1.06 2.064-2.093V4.821c-.001-1.032-1.032-1.646-2.064-1.646zm-4.989 9.869H6.666V11.5h7.35v1.544zm3.35-4.135H6.666V7.36h10.7v1.55z"></path></svg>
                        </button>
                        <button title="Menu" onClick={onOpenSettings}>
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 7a2 2 0 1 0-.001-4.001A2 2 0 0 0 12 7zm0 2a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 9zm0 6a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 15z"></path></svg>
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="p-2 bg-white dark:bg-black border-b border-gray-200 dark:border-[#1a1a1a]">
                    <div className="bg-light-secondary dark:bg-[#1a1a1a] rounded-lg flex items-center px-4 py-2">
                        <svg viewBox="0 0 24 24" width="24" height="24" className="text-gray-500 dark:text-gray-400 mr-4" fill="currentColor"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.41c0-2.877-2.332-5.207-5.207-5.207-2.876 0-5.208 2.33-5.208 5.207 0 2.876 2.332 5.208 5.208 5.208 1.341 0 2.568-.516 3.487-1.363l.215.215v.627l4.002 3.999 1.196-1.196-4.093-4.092zm-4.809 0c-1.711 0-3.097-1.386-3.097-3.097 0-1.711 1.386-3.097 3.097-3.097 1.711 0 3.097 1.386 3.097 3.097 0 1.711-1.386 3.097-3.097 3.097z"></path></svg>
                        <input 
                            type="text" 
                            placeholder="Search or start new chat" 
                            className="bg-transparent border-none outline-none text-sm w-full text-light-text dark:text-dark-text placeholder-gray-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Chat List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredChats.map((chat) => (
                        <div 
                            key={chat.id}
                            onClick={() => handleChatSelect(chat)}
                            className={`flex items-center p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#1a1a1a] ${selectedChatId === chat.id ? 'bg-gray-200 dark:bg-[#2a2a2a]' : ''}`}
                        >
                            <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-gray-600 mr-4 flex-shrink-0 overflow-hidden flex items-center justify-center">
                                {chat.avatar ? (
                                    <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover" />
                                ) : (
                                    chat.type === 'group' ? (
                                        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" className="text-white"><path d="M12.001 10.5c2.486 0 4.5-2.015 4.5-4.5s-2.014-4.5-4.5-4.5-4.5 2.015-4.5 4.5 2.014 4.5 4.5 4.5zm5.5 1.5h-1.922c-1.074.65-2.325 1-3.578 1-1.253 0-2.504-.35-3.578-1H6.501c-2.481 0-4.5 2.018-4.5 4.5v.5h19v-.5c0-2.482-2.019-4.5-4.5-4.5z"></path></svg>
                                    ) : (
                                        <svg viewBox="0 0 48 48" className="w-full h-full text-white" fill="currentColor">
                                            <path d="M24 23q-1.857 0-3.178-1.322Q19.5 20.357 19.5 18.5t1.322-3.178T24 14t3.178 1.322Q28.5 16.643 28.5 18.5t-1.322 3.178T24 23m-6.75 10q-.928 0-1.59-.66-.66-.662-.66-1.59v-.9q0-.956.492-1.758A3.3 3.3 0 0 1 16.8 26.87a16.7 16.7 0 0 1 3.544-1.308q1.8-.435 3.656-.436 1.856 0 3.656.436T31.2 26.87q.816.422 1.308 1.223T33 29.85v.9q0 .928-.66 1.59-.662.66-1.59.66z" />
                                        </svg>
                                    )
                                )}
                            </div>
                            <div className="flex-1 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
                                <div className="flex justify-between items-baseline mb-1">
                                    <h3 className="text-light-text dark:text-dark-text font-medium truncate">{chat.name}</h3>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Yesterday</span>
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{chat.subtitle}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right Side - Chat Detail */}
            <div className={`${selectedChatId ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full bg-[#efeae2] dark:bg-[#0d0d0d] relative`}>
                {selectedChatId ? (
                    <ChatDetail 
                        chatId={selectedChatId} 
                        chatName={selectedChatName} 
                        chatAvatar={selectedChatAvatar}
                        onBack={handleBack} 
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center z-10 text-center px-10 border-b-[6px] border-[#43d187]">
                        <div className="mb-8">
                            <svg viewBox="0 0 24 24" width="120" height="120" className="fill-current text-gray-300 dark:text-gray-600">
                                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                            </svg>
                        </div>
                        <h1 className="text-3xl font-light text-gray-600 dark:text-gray-300 mb-4">WhatsApp for Linux</h1>
                        <p className="text-gray-500 dark:text-gray-400">
                            Send and receive messages without keeping your phone online.<br/>
                            Use WhatsApp on up to 4 linked devices and 1 phone.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
