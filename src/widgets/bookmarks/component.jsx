import classNames from "classnames";
import Item from "components/bookmarks/item";
import Container from "components/services/widget/container";

import { columnMap } from "../../utils/layout/columns";

export default function Component({ service }) {
  const { widget } = service;
  const { bookmarks, layout } = widget;

  let classes = layout?.style === "row" ? `grid ${columnMap[layout?.columns]} gap-x-2` : "flex flex-col bookmark-list";
  const style = {};
  if (layout?.iconsOnly) {
    classes = "grid gap-2 bookmark-list mb-1";
    style.gridTemplateColumns = "repeat(auto-fill, minmax(60px, 1fr))";
  } else {
    classes += " -mb-1";
  }

  return (
    <Container service={service}>
      <ul className={classNames(classes, "w-full px-1 mt-1")} style={style}>
        {bookmarks.map((bookmark) => (
          <Item key={`${bookmark.name}-${bookmark.href}`} bookmark={bookmark} iconOnly={layout?.iconsOnly} />
        ))}
      </ul>
    </Container>
  );
}
