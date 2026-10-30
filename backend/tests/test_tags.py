from tests.conftest import ApiClient
from tests.factories import create_tag, create_task, register


def test_tag_crud_and_unique_names(api: ApiClient) -> None:
    register(api)
    tag = create_tag(api, "Work", "violet")

    duplicate = api.post("/api/v1/me/tags", json={"name": "work"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "tag_name_taken"

    renamed = api.patch(f"/api/v1/me/tags/{tag['id']}", json={"name": "Office", "color": "teal"})
    assert renamed.json() == {"id": tag["id"], "name": "Office", "color": "teal"}
    assert api.post("/api/v1/me/tags", json={"name": "x", "color": "neon"}).status_code == 422
    assert [t["name"] for t in api.get("/api/v1/me/tags").json()] == ["Office"]


def test_deleting_a_tag_detaches_it_from_tasks(api: ApiClient) -> None:
    register(api)
    tag = create_tag(api, "temp")
    task = create_task(api, "Tagged", tag_ids=[tag["id"]])

    assert api.delete(f"/api/v1/me/tags/{tag['id']}").status_code == 204
    assert api.get(f"/api/v1/tasks/{task['id']}").json()["tags"] == []


def test_tags_are_private(api: ApiClient, make_api) -> None:
    register(api)
    tag = create_tag(api, "mine")
    other = make_api()
    register(other, email="eve@example.com", name="Eve")

    assert other.get("/api/v1/me/tags").json() == []
    assert other.patch(f"/api/v1/me/tags/{tag['id']}", json={"name": "x"}).status_code == 404
    assert other.delete(f"/api/v1/me/tags/{tag['id']}").status_code == 404
    # Same name is fine for a different user.
    assert other.post("/api/v1/me/tags", json={"name": "mine"}).status_code == 201
