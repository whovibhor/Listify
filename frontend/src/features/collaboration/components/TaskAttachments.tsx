import { useRef, useState, type DragEvent } from 'react'
import { DownloadIcon, FileIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  attachmentDownloadUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from '@/features/collaboration/api'
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } from '@/features/collaboration/types'
import { errorText } from '@/lib/api-client'
import { cn } from '@/lib/utils'

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TaskAttachments({ taskId, canUpload }: { taskId: number; canUpload: boolean }) {
  const { data, isPending, isError } = useAttachments(taskId)
  const upload = useUploadAttachment(taskId)
  const remove = useDeleteAttachment(taskId)
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const fail = (error: Error) => toast.error(errorText(error))

  const send = (files: FileList | null) => {
    for (const file of files ?? []) {
      if (file.size > MAX_ATTACHMENT_BYTES) toast.error(`${file.name} is larger than 10 MB.`)
      else upload.mutate(file, { onError: fail })
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (canUpload) send(event.dataTransfer.files)
  }

  if (isPending) return <Skeleton className="h-16 w-full" />
  if (isError) {
    return <p className="text-sm text-muted-foreground">Attachments couldn't be loaded.</p>
  }

  return (
    <div className="space-y-2">
      {data.length === 0 && !canUpload ? (
        <p className="text-sm text-muted-foreground">No attachments.</p>
      ) : null}
      {data.length > 0 ? (
        <ul className="space-y-1.5">
          {data.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-2.5 text-sm"
            >
              <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{attachment.filename}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {fileSize(attachment.size_bytes)} · {attachment.uploaded_by.name}
                </span>
              </span>
              <Button variant="ghost" size="icon-sm" asChild>
                <a
                  href={attachmentDownloadUrl(attachment.id)}
                  download={attachment.filename}
                  aria-label={`Download ${attachment.filename}`}
                >
                  <DownloadIcon />
                </a>
              </Button>
              {attachment.can_delete && canUpload ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${attachment.filename}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(attachment.id, { onError: fail })}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canUpload ? (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2.5 text-sm text-muted-foreground transition-colors duration-(--duration-fast)',
            dragging && 'bg-accent',
          )}
        >
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={ATTACHMENT_ACCEPT}
            aria-label="Choose files to attach"
            onChange={(event) => {
              send(event.target.files)
              event.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            {upload.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <UploadIcon data-icon="inline-start" />
            )}
            Attach files
          </Button>
          <span>or drop them here. Up to 10 MB each.</span>
        </div>
      ) : null}
    </div>
  )
}
