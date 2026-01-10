'use client'

import React from 'react'

export interface TreeFolder {
  id: string
  name: string
  children: TreeFolder[]
}

interface FolderTreeProps {
  folders: TreeFolder[]
  onSelectFolder: (folderId: string) => void
  selectedFolderId: string
  level?: number
}

export function FolderTree({
  folders,
  onSelectFolder,
  selectedFolderId,
  level = 0,
}: FolderTreeProps) {
  return (
    <div className={level === 0 ? 'space-y-1' : 'ml-4 mt-1 space-y-1'}>
      {folders.map((folder) => (
        <div key={folder.id}>
          <button
            onClick={() => onSelectFolder(folder.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
              selectedFolderId === folder.id
                ? 'bg-purple-600 text-white font-semibold shadow-md'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="mr-2">
              {folder.children && folder.children.length > 0 ? '📁' : '📄'}
            </span>
            {folder.name}
          </button>
          {folder.children && folder.children.length > 0 && (
            <FolderTree
              folders={folder.children}
              onSelectFolder={onSelectFolder}
              selectedFolderId={selectedFolderId}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
  )
}
