<script setup lang="ts">
import type { TocItem } from '#shared/types/readme'
import { scrollToAnchor } from '~/utils/scrollToAnchor'

const props = defineProps<{
  toc: TocItem[]
  activeId?: string | null
  scrollToHeading?: (id: string) => void
}>()

interface TocNode extends TocItem {
  children: TocNode[]
}

function buildTocTree(items: TocItem[]): TocNode[] {
  const result: TocNode[] = []
  const stack: TocNode[] = []

  for (const item of items) {
    const node: TocNode = { ...item, children: [] }

    // Find parent: look for the last item with smaller depth
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= item.depth) {
      stack.pop()
    }

    if (stack.length === 0) {
      // Top-level item
      result.push(node)
    } else {
      // Child of the last item in stack
      stack[stack.length - 1]!.children.push(node)
    }

    stack.push(node)
  }

  return result
}

const tocTree = computed(() => buildTocTree(props.toc))

function handleClick(event: MouseEvent, id: string) {
  event.preventDefault()
  scrollToAnchor(id, props.scrollToHeading)
}
</script>

<template>
  <nav v-if="toc.length > 0" class="readme-toc" aria-labelledby="toc-heading">
    <h3 id="toc-heading" class="text-xs text-fg-subtle uppercase tracking-wider mb-3">
      {{ $t('package.readme.toc_title') }}
    </h3>
    <ul class="toc-list">
      <template v-for="node in tocTree" :key="node.id">
        <li class="toc-item">
          <a
            :href="`#${node.id}`"
            class="toc-link"
            :class="{ 'toc-link--active': activeId === node.id }"
            @click="handleClick($event, node.id)"
          >
            {{ node.text }}
          </a>
          <!-- Nested children -->
          <ul v-if="node.children.length > 0" class="toc-list toc-list--nested">
            <template v-for="child in node.children" :key="child.id">
              <li class="toc-item">
                <a
                  :href="`#${child.id}`"
                  class="toc-link"
                  :class="{
                    'toc-link--active': activeId === child.id,
                  }"
                  @click="handleClick($event, child.id)"
                >
                  {{ child.text }}
                </a>
                <!-- Support for 3rd level nesting -->
                <ul v-if="child.children.length > 0" class="toc-list toc-list--nested">
                  <li v-for="grandchild in child.children" :key="grandchild.id" class="toc-item">
                    <a
                      :href="`#${grandchild.id}`"
                      class="toc-link"
                      :class="{
                        'toc-link--active': activeId === grandchild.id,
                      }"
                      @click="handleClick($event, grandchild.id)"
                    >
                      {{ grandchild.text }}
                    </a>
                  </li>
                </ul>
              </li>
            </template>
          </ul>
        </li>
      </template>
    </ul>
  </nav>
</template>

<style scoped>
.readme-toc {
  max-height: calc(100vh - 12rem);
  overflow-y: auto;
  scrollbar-width: thin;
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-list--nested {
  padding-inline-start: 0.75rem;
  margin-block-start: 0.25rem;
  border-inline-start: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
}

.toc-item {
  margin: 0;
}

.toc-link {
  display: block;
  padding: 0.25rem 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--color-fg-muted);
  text-decoration: none;
  transition: color 0.15s ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-link:hover {
  color: var(--color-fg);
}

.toc-link--active {
  color: var(--color-fg);
  font-weight: 500;
}
</style>
