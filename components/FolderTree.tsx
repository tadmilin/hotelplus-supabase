'use client'

import React from 'react'

export interface TreeFolder {
  id: string
  name: string
  children: TreeFolder[]
  imageCount?: number
}

interface FolderTreeProps {
  folders: TreeFolder[]
  onSelectFolder: (folderId: string) => void
  selectedFolderId: string
  level?: number
  imageCounts?: Record<string, number>
}

export function FolderTree({
  folders,
  onSelectFolder,
  selectedFolderId,
  level = 0,
  imageCounts = {},
}: FolderTreeProps) {
  return (
    <div className={level === 0 ? 'space-y-1' : 'ml-4 mt-1 space-y-1'}>
      {folders.map((folder) => {
        const imageCount = imageCounts[folder.id] || 0
        const hasImages = imageCount > 0
        
        return (
          <div key={folder.id}>
            <button
              onClick={() => onSelectFolder(folder.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${
                selectedFolderId === folder.id
                  ? 'bg-purple-600 text-white font-semibold shadow-md'
                  : hasImages
                    ? 'bg-green-50 text-gray-800 hover:bg-green-100 border border-green-200'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              <span className="flex items-center gap-2">
                <span>{folder.children && folder.children.length > 0 ? '📁' : '📄'}</span>
                <span>{folder.name}</span>
              </span>
              {hasImages && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  selectedFolderId === folder.id
                    ? 'bg-white/20 text-white'
                    : 'bg-green-600 text-white'
                }`}>
                  {imageCount} รูป
                </span>
              )}
            </button>
            {folder.children && folder.children.length > 0 && (
              <FolderTree
                folders={folder.children}
                onSelectFolder={onSelectFolder}
                selectedFolderId={selectedFolderId}
                level={level + 1}
                imageCounts={imageCounts}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
