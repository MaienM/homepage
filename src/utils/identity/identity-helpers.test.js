import { describe, expect, it } from "vitest";
import { filterAllowedBookmarks, filterAllowedServices, filterAllowedWidgets, identityAllow } from "./identity-helpers";

const PERMS = {
  user: "testuser",
  groups: ["testgroup"],
};

describe("identityAllow", () => {
  it("should allow items with no allow rules", () => {
    const item = {};
    expect(identityAllow(PERMS, item)).toBeTruthy();
  });

  it("should allow items matching user", () => {
    const item = {
      allowUsers: ["testuser", "otheruser"],
      allowGroups: ["othergroup"],
    };
    expect(identityAllow(PERMS, item)).toBeTruthy();
  });

  it("should allow items matching group", () => {
    const item = {
      allowUsers: ["otheruser"],
      allowGroups: ["testgroup", "othergroup"],
    };
    expect(identityAllow(PERMS, item)).toBeTruthy();
  });

  it("should deny items without matching user or group", () => {
    const item = {
      allowUsers: ["otheruser"],
      allowGroups: ["othergroup"],
    };
    expect(identityAllow(PERMS, item)).toBeFalsy();
  });
});

describe("filterAllowedServices", () => {
  it("should filter services", () => {
    const services = [
      {
        name: "Group 1",
        services: [
          {
            name: "Service 1",
          },
          {
            name: "Service 2",
            allowUsers: ["testuser"],
          },
          {
            name: "Service 3",
            allowUsers: ["otheruser"],
          },
        ],
      },
    ];
    expect(filterAllowedServices(PERMS, [], services)).toEqual([
      {
        name: "Group 1",
        services: [
          {
            name: "Service 1",
          },
          {
            name: "Service 2",
            allowUsers: ["testuser"],
          },
        ],
      },
    ]);
  });

  it("should remove empty groups after filtering", () => {
    const services = [
      {
        name: "Group 1",
        services: [
          {
            name: "Service 1",
          },
        ],
      },
      {
        name: "Group 2",
        services: [
          {
            name: "Service 2",
            allowUsers: ["otheruser"],
          },
        ],
      },
    ];
    expect(filterAllowedServices(PERMS, [], services)).toEqual([
      {
        name: "Group 1",
        services: [
          {
            name: "Service 1",
          },
        ],
      },
    ]);
  });

  it("should filter service widgets", () => {
    const services = [
      {
        name: "Group 1",
        services: [
          {
            name: "Service 1",
            widget: {
              type: "foo",
              allowUsers: ["testuser"],
            },
          },
          {
            name: "Service 2",
            widget: {
              type: "bar",
              allowUsers: ["otheruser"],
            },
          },
          {
            name: "Service 3",
            widgets: [
              {
                type: "foo",
                allowUsers: ["testuser"],
              },
              {
                type: "bar",
                allowUsers: ["otheruser"],
              },
              {
                type: "baz",
              },
            ],
          },
        ],
      },
    ];
    expect(filterAllowedServices(PERMS, [], services)).toEqual([
      {
        name: "Group 1",
        services: [
          {
            name: "Service 1",
            widget: {
              type: "foo",
              allowUsers: ["testuser"],
            },
          },
          {
            name: "Service 2",
          },
          {
            name: "Service 3",
            widgets: [
              {
                type: "foo",
                allowUsers: ["testuser"],
              },
              {
                type: "baz",
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("filterAllowedBookmarks", () => {
  it("should filter bookmarks", () => {
    const bookmarks = [
      {
        name: "Group 1",
        bookmarks: [
          {
            name: "Bookmark 1",
          },
          {
            name: "Bookmark 2",
            allowUsers: ["testuser"],
          },
          {
            name: "Bookmark 3",
            allowUsers: ["otheruser"],
          },
        ],
      },
    ];
    expect(filterAllowedBookmarks(PERMS, [], bookmarks)).toEqual([
      {
        name: "Group 1",
        bookmarks: [
          {
            name: "Bookmark 1",
          },
          {
            name: "Bookmark 2",
            allowUsers: ["testuser"],
          },
        ],
      },
    ]);
  });

  it("should remove empty groups after filtering", () => {
    const bookmarks = [
      {
        name: "Group 1",
        bookmarks: [
          {
            name: "Bookmark 1",
          },
        ],
      },
      {
        name: "Group 2",
        bookmarks: [
          {
            name: "Bookmark 2",
            allowUsers: ["otheruser"],
          },
        ],
      },
    ];
    expect(filterAllowedBookmarks(PERMS, [], bookmarks)).toEqual([
      {
        name: "Group 1",
        bookmarks: [
          {
            name: "Bookmark 1",
          },
        ],
      },
    ]);
  });
});

describe("filterAllowedWidgets", () => {
  it("should filter widgets", () => {
    const widgets = [
      {
        name: "Widget 1",
        options: {},
      },
      {
        name: "Widget 2",
        options: {
          allowUsers: ["testuser"],
        },
      },
      {
        name: "Widget 3",
        options: {
          allowUsers: ["otheruser"],
        },
      },
    ];
    expect(filterAllowedWidgets(PERMS, widgets)).toEqual([
      {
        name: "Widget 1",
        options: {},
      },
      {
        name: "Widget 2",
        options: {
          allowUsers: ["testuser"],
        },
      },
    ]);
  });
});
